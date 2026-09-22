import { createConnection } from "node:net";
import { dirname } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ProjectPreview } from "../packages/protocol/src/project-preview.ts";
import { PATHS } from "./config.ts";

const DEFAULT_PREVIEW_PORT = 5173;
const MAX_BODY = 16 * 1024;
type Session = { id: string; owner: string | null };

class PreviewError extends Error {
  constructor(public code: number, message: string) { super(message); }
}

function validPreviewPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535;
}

export async function portIsListening(port: number, timeoutMs = 1_500): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}

function readRows(path: string): ProjectPreview[] {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(value)) return [];
    return value.filter((row): row is ProjectPreview =>
      row && typeof row === "object" && typeof row.sessionId === "string" &&
      typeof row.title === "string" && typeof row.url === "string" &&
      validPreviewPort(row.port) && row.kind === "sandbox-preview" &&
      row.visibility === "owner" && row.temporary === true &&
      typeof row.createdAt === "number");
  } catch {
    return [];
  }
}

function saveRows(path: string, rows: ProjectPreview[]): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

export function createProjectPreviewService(deps: {
  session(id: string): Promise<Session | null>;
  viewer(req: Request): string;
  resolve(port: number): Promise<{ url: string }>;
  listening?: (port: number) => Promise<boolean>;
  storePath?: string;
  now?: () => number;
}) {
  const storePath = deps.storePath ?? `${PATHS.data}/project-previews.json`;
  const rows = new Map(readRows(storePath).map((row) => [row.sessionId, row]));
  const now = deps.now ?? Date.now;
  const listening = deps.listening ?? portIsListening;
  const owns = (owner: string | null, viewer: string) => !owner || owner.toLowerCase() === viewer.toLowerCase();

  return async function handle(req: Request): Promise<Response> {
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
    try {
      const url = new URL(req.url);
      let data: Record<string, unknown> = {};
      if (req.method === "POST") {
        const text = await req.text();
        if (text.length > MAX_BODY) throw new PreviewError(413, "Preview request is too large");
        try {
          const parsed = JSON.parse(text) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new PreviewError(400, "Preview request must be a JSON object");
          }
          data = parsed as Record<string, unknown>;
        } catch (error) {
          if (error instanceof PreviewError) throw error;
          throw new PreviewError(400, "Invalid preview request");
        }
      }
      const requestedSession = url.searchParams.get("sessionId") ?? data.sessionId;
      if (typeof requestedSession !== "string") throw new PreviewError(400, "sessionId is required");
      const session = await deps.session(requestedSession);
      if (!session) throw new PreviewError(404, "Session not found");
      const caller = req.headers.get("x-omg-caller-session-id")?.trim();
      if (caller) {
        const agentSession = await deps.session(caller);
        if (agentSession?.id !== session.id) throw new PreviewError(403, "Use your own session for project preview");
      } else if (!owns(session.owner, deps.viewer(req))) {
        throw new PreviewError(403, "This preview belongs to another user");
      }

      if (req.method === "GET") return json({ preview: rows.get(session.id) ?? null });
      if (req.method !== "POST") throw new PreviewError(405, "Method not allowed");
      if (!caller) throw new PreviewError(403, "Only the session agent can publish a project preview");
      const port = data.port === undefined ? DEFAULT_PREVIEW_PORT : data.port;
      if (!validPreviewPort(port)) throw new PreviewError(400, "Preview port must be an integer from 1 to 65535");
      if (!(await listening(port))) {
        throw new PreviewError(409, `Nothing is listening on port ${port}. Start the web development server first.`);
      }
      const title = typeof data.title === "string" && data.title.trim()
        ? data.title.trim().slice(0, 120)
        : "Live project preview";
      const resolved = await deps.resolve(port);
      const target = new URL(resolved.url);
      if (target.protocol !== "https:" || target.username || target.password) {
        throw new PreviewError(502, "Cloud returned an invalid preview URL");
      }
      const preview: ProjectPreview = {
        sessionId: session.id,
        title,
        url: target.href.replace(/\/$/, ""),
        port,
        kind: "sandbox-preview",
        visibility: "owner",
        temporary: true,
        createdAt: now(),
      };
      rows.set(session.id, preview);
      saveRows(storePath, [...rows.values()]);
      return json({ preview });
    } catch (error) {
      const externalStatus = typeof (error as { status?: unknown } | null)?.status === "number"
        ? (error as { status: number }).status : 502;
      return json({ error: error instanceof Error ? error.message : "Project preview failed" }, error instanceof PreviewError ? error.code : externalStatus);
    }
  };
}
