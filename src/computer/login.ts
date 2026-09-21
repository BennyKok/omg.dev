import { randomUUID, timingSafeEqual } from "node:crypto";
import { getDomain } from "tldts";
import type { BrowserLoginCookie, BrowserLoginRequest } from "../../packages/protocol/src/browser-login";

const TTL = 10 * 60_000;
const LEASE = 45_000;
const MAX_BODY = 256 * 1024;
const live = (r: BrowserLoginRequest) => ["pending", "in_progress", "importing"].includes(r.status);
type Session = { id: string; owner: string | null };
type Row = { public: BrowserLoginRequest; owner: string | null; token?: string; claimant?: string };

class LoginError extends Error {
  constructor(public code: number, message: string) { super(message); }
}
function reject(message: string): never { throw new LoginError(400, message); }
function loginUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2048) reject("A website URL is required");
  let url: URL;
  try { url = new URL(value); } catch { return reject("Invalid website URL"); }
  if (url.protocol !== "https:" || url.username || url.password || !getDomain(url.hostname, { allowPrivateDomains: true })) {
    reject("Use a public HTTPS website without credentials in its URL");
  }
  url.hash = "";
  return url;
}

export function validateLoginCookies(input: unknown, origin: string, now = Date.now()): BrowserLoginCookie[] {
  if (!Array.isArray(input) || !input.length || input.length > 200) reject("Provide between 1 and 200 site cookies");
  const host = new URL(origin).hostname;
  const site = getDomain(host, { allowPrivateDomains: true });
  return input.map((raw) => {
    if (!raw || typeof raw !== "object") reject("Invalid cookie");
    const c = raw as Record<string, unknown>;
    if (typeof c.domain !== "string") reject("Invalid cookie domain");
    const domain = c.domain.toLowerCase();
    const bare = domain.replace(/^\./, "");
    if (getDomain(bare, { allowPrivateDomains: true }) !== site ||
      !(host === bare || (domain.startsWith(".") && host.endsWith(`.${bare}`)))) reject("Cookie is outside the approved website");
    if (typeof c.name !== "string" || !c.name || c.name.length > 256 || /[\s;=\x00-\x1f\x7f]/.test(c.name) ||
      typeof c.value !== "string" || c.value.length > 8192 || /[\x00-\x1f\x7f]/.test(c.value) ||
      typeof c.path !== "string" || !c.path.startsWith("/") || c.path.length > 2048 ||
      typeof c.secure !== "boolean" || typeof c.httpOnly !== "boolean") reject("Invalid cookie fields");
    if (c.expires !== undefined && (typeof c.expires !== "number" || !Number.isFinite(c.expires) || c.expires * 1000 <= now)) reject("Invalid or expired cookie");
    if (c.sameSite !== undefined && !["Strict", "Lax", "None"].includes(c.sameSite as string)) reject("Invalid cookie SameSite");
    if (c.name.startsWith("__Host-") && (domain.startsWith(".") || c.path !== "/" || !c.secure)) reject("Invalid host cookie");
    return { name: c.name, value: c.value, domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
      ...(c.expires !== undefined ? { expires: c.expires as number } : {}),
      ...(c.sameSite !== undefined ? { sameSite: c.sameSite as BrowserLoginCookie["sameSite"] } : {}) };
  });
}

/** Serve owns this instance. No secrets are persisted or returned in public state. */
export function createBrowserLoginService(deps: {
  session(id: string): Promise<Session | null>;
  viewer(req: Request): string;
  available(): boolean;
  computerName?(): string;
  importCookies(url: string, cookies: BrowserLoginCookie[]): Promise<void>;
  notify?(request: BrowserLoginRequest, owner: string | null): Promise<void>;
  completed?(request: BrowserLoginRequest): Promise<boolean>;
  now?: () => number;
}) {
  const rows = new Map<string, Row>();
  const clients = new Map<string, { session: string; viewer: string; until: number }>();
  const now = deps.now ?? Date.now;
  let importing = false;
  function sweep() {
    for (const [id, row] of rows) {
      if (row.public.expiresAt <= now() && live(row.public) && row.public.status !== "importing") {
        row.public.status = "expired"; delete row.token;
      }
      if (row.public.expiresAt + TTL <= now() && row.public.status !== "importing") rows.delete(id);
    }
    for (const [id, c] of clients) if (c.until <= now()) clients.delete(id);
  }
  function owns(owner: string | null, viewer: string) { return !owner || owner.toLowerCase() === viewer.toLowerCase(); }
  const publicRow = (row: Row) => ({ ...row.public });
  function available(session: string, owner: string | null) {
    return [...clients.values()].some(c => c.session === session && owns(owner, c.viewer));
  }
  async function body(req: Request): Promise<Record<string, unknown>> {
    const text = await req.text();
    if (text.length > MAX_BODY) throw new LoginError(413, "Login transfer is too large");
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
    return reject("Invalid login request");
  }
  return async function handle(req: Request): Promise<Response> {
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
    try {
      sweep();
      const url = new URL(req.url);
      const action = url.pathname.slice("/api/browser-login".length);
      const data = req.method === "POST" ? await body(req) : {};
      const requestedSession = url.searchParams.get("sessionId") ?? data.sessionId;
      if (typeof requestedSession !== "string") reject("sessionId is required");
      const session = await deps.session(requestedSession);
      if (!session) throw new LoginError(404, "Session not found");
      const caller = req.headers.get("x-omg-caller-session-id");
      if (caller) {
        const agentSession = await deps.session(caller);
        if (agentSession?.id !== session.id) throw new LoginError(403, "Use your own session for browser login");
      }
      const viewer = deps.viewer(req);
      if (!caller && !owns(session.owner, viewer)) throw new LoginError(403, "This login belongs to another user");
      if (action === "" && req.method === "GET") return json({
        requests: [...rows.values()].filter(r => r.public.sessionId === session.id).map(publicRow),
        iosAvailable: available(session.id, session.owner), desktopAvailable: deps.available(),
      });
      if (action === "/clients" && req.method === "POST") {
        if (caller) throw new LoginError(403, "Client presence is for the user interface");
        if (typeof data.clientId !== "string" || data.clientId.length > 100) reject("Invalid client id");
        const key = `${session.id}:${viewer}:${data.clientId}`;
        if (data.supported === true) {
          if (clients.size >= 200 && !clients.has(key)) throw new LoginError(429, "Too many login clients");
          clients.set(key, { session: session.id, viewer, until: now() + LEASE });
        } else clients.delete(key);
        return json({ ok: true });
      }
      if (action === "" && req.method === "POST") {
        if (!deps.available()) throw new LoginError(409, "Browser login needs the Computer browser on this machine");
        const target = loginUrl(data.url);
        if (typeof data.reason !== "string" || !data.reason.trim() || data.reason.length > 500) reject("A short login reason is required");
        const existing = [...rows.values()].find(r => r.public.sessionId === session.id && r.public.origin === target.origin && live(r.public));
        if (existing) return json({ request: publicRow(existing), iosAvailable: available(session.id, session.owner) });
        if (rows.size >= 100) throw new LoginError(429, "Too many login requests");
        const row: Row = { owner: session.owner, public: {
          id: randomUUID(), sessionId: session.id, url: target.href, origin: target.origin,
          computerName: deps.computerName?.() || "this computer",
          reason: data.reason.trim(), status: "pending", createdAt: now(), expiresAt: now() + TTL,
        } };
        rows.set(row.public.id, row);
        void deps.notify?.(publicRow(row), session.owner).catch(() => {});
        return json({ request: publicRow(row), iosAvailable: available(session.id, session.owner) });
      }
      const match = /^\/([0-9a-f-]+)(?:\/(claim|complete|cancel))?$/.exec(action);
      const row = match ? rows.get(match[1]!) : undefined;
      if (!match || !row || row.public.sessionId !== session.id) throw new LoginError(404, "Login request not found or no longer available");
      if (!match?.[2] && req.method === "GET") return json({ request: publicRow(row) });
      if (req.method !== "POST") throw new LoginError(405, "Method not allowed");
      if (caller) throw new LoginError(403, "Only the user can approve or cancel a login transfer");
      if (match[2] === "cancel") {
        if (row.public.status === "importing") throw new LoginError(409, "The transfer has already started");
        if (live(row.public)) { row.public.status = "cancelled"; delete row.token; }
        return json({ request: publicRow(row) });
      }
      if (!live(row.public) || row.public.status === "importing") throw new LoginError(409, "This login request is no longer open");
      if (match[2] === "claim") {
        if (row.public.status !== "pending") throw new LoginError(409, "This login is already open on another device");
        row.token = randomUUID(); row.claimant = viewer;
        row.public.status = "in_progress";
        return json({ request: publicRow(row), token: row.token });
      }
      if (match[2] === "complete") {
        const token = typeof data.token === "string" ? data.token : "";
        if (!row.token || token.length !== row.token.length || !timingSafeEqual(Buffer.from(token), Buffer.from(row.token)) || row.claimant !== viewer || data.approved !== true) {
          throw new LoginError(403, "Open and approve this login on the same device first");
        }
        const cookies = validateLoginCookies(data.cookies, row.public.origin, now());
        if (importing) throw new LoginError(409, "Another login transfer is running. Try again");
        importing = true; row.public.status = "importing"; delete row.token;
        try {
          await deps.importCookies(row.public.url, cookies);
          row.public.status = "imported"; row.public.cookieCount = cookies.length;
          row.public.message = "Login transferred. The agent must verify the signed-in page before continuing.";
        } catch {
          row.public.status = "failed";
          row.public.message = "Could not transfer the login. Request a new login or use the Computer browser.";
        } finally { importing = false; cookies.length = 0; }
        if (row.public.status === "imported") {
          row.public.agentNotified = await deps.completed?.(publicRow(row)).catch(() => false) ?? false;
        }
        return json({ request: publicRow(row) });
      }
      throw new LoginError(404, "Unknown login action");
    } catch (error) {
      // Never echo provider, CDP, URL, or cookie payload errors into the transcript.
      return json({ error: error instanceof LoginError ? error.message : "Browser login failed" }, error instanceof LoginError ? error.code : 500);
    }
  };
}
