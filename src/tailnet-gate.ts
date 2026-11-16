// Tailnet entry point for `lfg serve`.
//
// `lfg serve` has no login of its own (see SECURITY.md): its API trusts every
// caller that can reach the port. That is correct for loopback callers (agent
// tools on this box). It is wrong for a tailnet: any device on the tailnet (a
// shared Mac, a tagged server, another person's phone) could list sessions,
// start agents and send them input.
//
// When LFG_TAILNET_PORT is set, `lfg serve` opens a second loopback listener
// for `tailscale serve` to point at. Every request on it came from the
// tailnet, so the gate below applies to all of them, with no header guessing:
//
// - The connector OAuth callback passes through: the provider redirects the
//   browser there, and the handler only accepts a state this box issued.
// - Everything else, page loads, the API and websockets included, gets 401.
//
// - A linked omg.dev box (src/peer-machines.ts) passes with this box's peer
//   token, as `Authorization: Bearer` or a `lfg-bearer.<token>` websocket
//   subprotocol. The token exists for the gate only while the owner has turned
//   on "Allow linking" in Settings > Remote access. It still cannot reach
//   `/api/peers*`.
//
// - A PERSON passes when Tailscale identity is on (LFG_TAILNET_IDENTITY=1) and
//   their Tailscale login is on this computer's user list. `tailscale serve`
//   adds the login to every request it proxies (`Tailscale-User-Login`). This
//   listener is loopback-only and is where `tailscale serve` points, so the
//   header here was written by Tailscale and not by the caller. A login that
//   is not on the list gets 403. The server then treats that login as the
//   user for the request (tailnetPersonOf), whatever profile the browser
//   picked. Off by default: without the switch, no person passes, as before.
//
// Linked devices (src/devices) are handled before this gate: `/api/devices/link/*`
// goes to their own handler, which requires a device signature on every call
// except pairing (a one-use code). Nothing else on the API opens.

import { timingSafeEqual } from "node:crypto";

export const TAILNET_PASSTHROUGH_PATHS = new Set(["/api/connectors/oauth/callback"]);

export type TailnetGateOptions = {
  /** Shared peer bearer token accepted from linked remote omg.dev boxes. */
  peerToken?: string | null;
  /**
   * Tailscale identity. Absent or `enabled: false` admits no person.
   * `isMember` answers for a lower-cased login.
   */
  people?: { enabled: boolean; isMember: (login: string) => boolean };
};

/** A person signed in to the tailnet, as `tailscale serve` reports them. */
export type TailnetPerson = { login: string; name: string | null; picture: string | null };

/** Tailscale percent-encodes non-ASCII header values (RFC 2047 is also allowed; that form is left as sent). */
function headerText(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return decodeURIComponent(trimmed).slice(0, 200);
  } catch {
    return trimmed.slice(0, 200);
  }
}

/**
 * The person `tailscale serve` named on this request, or null. A tagged
 * device and a Funnel visitor carry no login, so they are never a person.
 * The login must look like an address: it becomes a user id.
 */
export function tailnetPerson(req: Request): TailnetPerson | null {
  const login = req.headers.get("tailscale-user-login")?.trim().toLowerCase();
  if (!login || login.length > 254 || !/^[^\s@,;<>"']+@[^\s@,;<>"']+$/.test(login)) return null;
  const picture = req.headers.get("tailscale-user-profile-pic")?.trim() || null;
  return {
    login,
    name: headerText(req.headers.get("tailscale-user-name")),
    picture: picture && /^https:\/\//i.test(picture) ? picture.slice(0, 2000) : null,
  };
}

// The person each admitted request belongs to. Keyed by the request object
// the tailnet listener hands to the main handler, so no header or query
// value from the caller can set it, and a request on the main port never has
// one.
const ADMITTED = new WeakMap<Request, TailnetPerson>();

// What Tailscale last said about each admitted person, for Settings > People.
// In memory only: it is a display aid, rebuilt as people use the computer.
const SEEN = new Map<string, { name: string | null; picture: string | null; lastSeenAt: number }>();
const SEEN_LIMIT = 200;

function remember(person: TailnetPerson): void {
  SEEN.delete(person.login);
  SEEN.set(person.login, { name: person.name, picture: person.picture, lastSeenAt: Date.now() });
  while (SEEN.size > SEEN_LIMIT) SEEN.delete(SEEN.keys().next().value as string);
}

/** Tailscale's name and picture for a login the gate admitted, or null. */
export function seenTailnetPerson(login: string): { name: string | null; picture: string | null; lastSeenAt: number } | null {
  return SEEN.get(login.trim().toLowerCase()) ?? null;
}

/** The tailnet person this request was admitted as, or null. */
export function tailnetPersonOf(req: Request): TailnetPerson | null {
  return ADMITTED.get(req) ?? null;
}

function matchesToken(candidate: string | null | undefined, expected: string): boolean {
  const trimmed = candidate?.trim();
  if (!trimmed || trimmed.length !== expected.length) return false;
  const a = Buffer.from(trimmed, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requestHasPeerToken(req: Request, expectedToken: string | null | undefined): boolean {
  const expected = expectedToken?.trim();
  if (!expected) return false;

  const auth = req.headers.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    const token = auth.replace(/^bearer\s+/i, "").trim();
    if (matchesToken(token, expected)) return true;
  }

  const protocols = req.headers.get("sec-websocket-protocol");
  if (protocols) {
    for (const part of protocols.split(",")) {
      const protocol = part.trim();
      if (protocol.startsWith("lfg-bearer.")) {
        const token = protocol.slice("lfg-bearer.".length);
        if (matchesToken(token, expected)) return true;
      }
    }
  }

  return false;
}

/**
 * Returns the response for a tailnet request, or null when the request may
 * reach the normal `lfg serve` handler.
 */
export function tailnetGateResponse(req: Request, options: TailnetGateOptions = {}): Response | null {
  const path = new URL(req.url).pathname;
  if (req.method === "GET" && TAILNET_PASSTHROUGH_PATHS.has(path)) return null;
  if (requestHasPeerToken(req, options.peerToken)) {
    // A linked box controls this box's sessions. It does not manage links:
    // no reading or rotating this box's token, no turning inbound access off,
    // and no hop through this box's proxy to the boxes IT has linked.
    if (path === "/api/peers" || path.startsWith("/api/peers/")) {
      return Response.json(
        { error: "linked machines cannot manage links" },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
    return null;
  }
  if (options.people?.enabled) {
    const person = tailnetPerson(req);
    if (person) {
      if (options.people.isMember(person.login)) {
        ADMITTED.set(req, person);
        remember(person);
        return null;
      }
      // Known to the tailnet, not to this computer. The owner adds a person
      // on the computer itself; nothing a visitor sends can do it.
      return Response.json(
        {
          error: "not on this computer's user list",
          detail: `${person.login} is signed in to the tailnet, but the owner of this computer has not added this user.`,
        },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
  }
  return Response.json(
    {
      error: "sign-in required",
      detail: "This computer is not open to the tailnet. Open it on this computer.",
    },
    { status: 401, headers: { "cache-control": "no-store", "www-authenticate": 'Bearer realm="omg"' } },
  );
}

/** LFG_TAILNET_IDENTITY: "1" or "true" turns Tailscale identity on. Anything else is off. */
export function tailnetIdentityFromEnv(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/** Parses LFG_TAILNET_PORT. 0 means off. Fails loud on a bad value. */
export function tailnetPortFromEnv(raw: string | undefined, mainPort: number): number {
  const value = raw?.trim();
  if (!value) return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === mainPort) {
    throw new Error(`LFG_TAILNET_PORT must be a free TCP port other than LFG_PORT, got "${value}"`);
  }
  return port;
}
