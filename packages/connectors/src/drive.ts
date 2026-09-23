// omg's own Google Drive connector: agent tools over the Drive REST API
// (www.googleapis.com/drive/v3).
//
// Same shape as ./gmail.ts, for the same reason: Google's Drive MCP server
// (drivemcp.googleapis.com) answers tool calls only for Cloud projects in the
// Workspace Developer Preview Program, while the REST API is generally
// available and accepts the token. omg signs in against the MCP server's
// resource metadata (for the scopes) and calls REST itself.
//
// Reading is the common job, so read_file returns text for every Google file
// type (Docs as plain text, Sheets as CSV, Slides as plain text) and for text
// uploads. A binary file returns its metadata and link, not bytes.
import type { NativeCallResult, NativeTool, TokenSource } from "./gmail.ts";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const MAX_TEXT_CHARS = 50_000;
const MAX_RESULTS = 50;
const FILE_FIELDS = "id,name,mimeType,modifiedTime,size,webViewLink,parents,owners(emailAddress),trashed";

const str = { type: "string" } as const;

/** Google file types and the text format each one exports to. */
const EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.drawing": "image/svg+xml",
  "application/vnd.google-apps.script": "application/vnd.google-apps.script+json",
};

export const DRIVE_TOOLS: NativeTool[] = [
  {
    name: "search_files",
    description:
      "Find files in Google Drive. `text` matches names and content. `query` takes Drive query syntax (e.g. `mimeType = 'application/vnd.google-apps.document' and modifiedTime > '2026-01-01'`). With neither, lists the most recently modified files.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Words to find in file names or content." },
        query: { type: "string", description: "Raw Drive query, combined with `text` by AND." },
        folder_id: { type: "string", description: "Only files directly in this folder." },
        max_results: { type: "number", description: `1 to ${MAX_RESULTS}. Default 20.` },
        page_token: { type: "string", description: "next_page_token from a previous call." },
      },
    },
  },
  {
    name: "get_file",
    description: "File metadata: name, type, size, modified time, owners, parent folders and the web link.",
    inputSchema: { type: "object", properties: { file_id: str }, required: ["file_id"] },
  },
  {
    name: "read_file",
    description:
      "Read a file as text. Google Docs and Slides come back as plain text, Sheets as CSV (first sheet), and text uploads as they are. Binary files return metadata only.",
    inputSchema: { type: "object", properties: { file_id: str }, required: ["file_id"] },
  },
  {
    name: "create_file",
    description:
      "Create a file from text. Set as_google_doc to make an editable Google Doc (or a Google Sheet when mime_type is text/csv).",
    inputSchema: {
      type: "object",
      properties: {
        name: str,
        content: { type: "string", description: "The file's text." },
        mime_type: { type: "string", description: "Default text/plain. Use text/csv, text/markdown, text/html, application/json as needed." },
        folder_id: { type: "string", description: "Parent folder. Default: My Drive root." },
        as_google_doc: { type: "boolean", description: "Convert to a Google Doc (or Sheet for text/csv)." },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "trash_file",
    description: "Move a file to the Drive trash. It can be restored from the trash for 30 days.",
    inputSchema: { type: "object", properties: { file_id: str }, required: ["file_id"] },
  },
];

class DriveError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

async function send(token: TokenSource, url: string, init: RequestInit, fetchImpl: Fetch): Promise<Response> {
  const go = async (force: boolean) =>
    fetchImpl(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await token(force)}` } });
  const res = await go(false);
  // An access token can be revoked or expire early; refresh once and retry.
  return res.status === 401 ? go(true) : res;
}

async function failure(res: Response): Promise<DriveError> {
  const raw = await res.text().catch(() => "");
  let message = `Drive request failed (${res.status})`;
  try {
    message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? message;
  } catch {
    // A proxy or outage page is not JSON; keep the status.
  }
  return new DriveError(scopeHint(message), res.status);
}

/**
 * Google's consent screen lists each Drive permission with its own checkbox,
 * all unticked. Continue without ticking them and the sign-in succeeds with a
 * token that can do nothing, so every call fails with this message. Say what
 * to do about it.
 */
export function scopeHint(message: string): string {
  return /insufficient (authentication )?scopes?/i.test(message)
    ? `${message} Reconnect this connector and tick every permission box on Google's consent screen.`
    : message;
}

async function json(token: TokenSource, url: string, init: RequestInit, fetchImpl: Fetch): Promise<unknown> {
  const res = await send(token, url, init, fetchImpl);
  if (!res.ok) throw await failure(res);
  const raw = await res.text();
  try {
    return raw ? (JSON.parse(raw) as unknown) : {};
  } catch {
    throw new DriveError("Drive returned a response that is not JSON");
  }
}

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  owners?: { emailAddress?: string }[];
  trashed?: boolean;
};

function view(f: DriveFile) {
  return {
    file_id: f.id,
    name: f.name,
    mime_type: f.mimeType,
    modified: f.modifiedTime ?? null,
    size: f.size ? Number(f.size) : null,
    link: f.webViewLink ?? null,
    owners: (f.owners ?? []).map((o) => o.emailAddress).filter(Boolean),
    parents: f.parents ?? [],
  };
}

/** A Drive query string literal: single quotes and backslashes escaped. */
export function driveLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function buildSearchQuery(args: { text?: unknown; query?: unknown; folder_id?: unknown }): string {
  const parts = ["trashed = false"];
  if (typeof args.text === "string" && args.text.trim()) parts.push(`fullText contains ${driveLiteral(args.text.trim())}`);
  if (typeof args.folder_id === "string" && args.folder_id.trim()) parts.push(`${driveLiteral(args.folder_id.trim())} in parents`);
  if (typeof args.query === "string" && args.query.trim()) parts.push(`(${args.query.trim()})`);
  return parts.join(" and ");
}

function isTextual(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript", "application/x-yaml", "application/yaml"].includes(mime)
  );
}

function clip(s: string): { text: string; truncated: boolean } {
  return s.length > MAX_TEXT_CHARS ? { text: s.slice(0, MAX_TEXT_CHARS), truncated: true } : { text: s, truncated: false };
}

function text(value: unknown): NativeCallResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], isError: false };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new DriveError(`${key} is required`);
  return v.trim();
}

function fileUrl(id: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ supportsAllDrives: "true", ...params });
  return `${API}/files/${encodeURIComponent(id)}?${q}`;
}

/** Run one Drive tool. Errors come back as an error result, not a throw. */
export async function callDriveTool(
  token: TokenSource,
  name: string,
  args: Record<string, unknown>,
  fetchImpl: Fetch = fetch,
): Promise<NativeCallResult> {
  try {
    switch (name) {
      case "search_files": {
        const max = Math.min(Math.max(Number(args.max_results) || 20, 1), MAX_RESULTS);
        const hasText = typeof args.text === "string" && args.text.trim() !== "";
        const params = new URLSearchParams({
          q: buildSearchQuery(args),
          pageSize: String(max),
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        // Drive rejects orderBy together with a fullText search.
        if (!hasText) params.set("orderBy", "modifiedTime desc");
        if (typeof args.page_token === "string" && args.page_token) params.set("pageToken", args.page_token);
        const res = (await json(token, `${API}/files?${params}`, { method: "GET" }, fetchImpl)) as {
          files?: DriveFile[];
          nextPageToken?: string;
        };
        return text({ files: (res.files ?? []).map(view), next_page_token: res.nextPageToken ?? null });
      }
      case "get_file": {
        const id = requireString(args, "file_id");
        const f = (await json(token, fileUrl(id, { fields: FILE_FIELDS }), { method: "GET" }, fetchImpl)) as DriveFile;
        return text(view(f));
      }
      case "read_file": {
        const id = requireString(args, "file_id");
        const f = (await json(token, fileUrl(id, { fields: FILE_FIELDS }), { method: "GET" }, fetchImpl)) as DriveFile;
        const exportAs = EXPORTS[f.mimeType];
        let url: string | null = null;
        if (exportAs) url = `${API}/files/${encodeURIComponent(id)}/export?${new URLSearchParams({ mimeType: exportAs })}`;
        else if (isTextual(f.mimeType)) url = fileUrl(id, { alt: "media" });
        if (!url) {
          return text({ ...view(f), content: null, note: "This is a binary file. Open the link to view it." });
        }
        const res = await send(token, url, { method: "GET" }, fetchImpl);
        if (!res.ok) throw await failure(res);
        // Google exports Docs with CRLF line ends; agents read plain \n.
        const body = clip((await res.text()).replace(/\r\n/g, "\n"));
        return text({ ...view(f), content: body.text, ...(body.truncated ? { truncated: true } : {}) });
      }
      case "create_file": {
        const fileName = requireString(args, "name");
        const content = typeof args.content === "string" ? args.content : "";
        const mime = typeof args.mime_type === "string" && args.mime_type.trim() ? args.mime_type.trim() : "text/plain";
        const metadata: Record<string, unknown> = { name: fileName };
        if (args.as_google_doc === true) {
          metadata.mimeType = mime === "text/csv" ? "application/vnd.google-apps.spreadsheet" : "application/vnd.google-apps.document";
        }
        if (typeof args.folder_id === "string" && args.folder_id.trim()) metadata.parents = [args.folder_id.trim()];
        const boundary = `omg${crypto.randomUUID().replace(/-/g, "")}`;
        const body =
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
        const params = new URLSearchParams({ uploadType: "multipart", supportsAllDrives: "true", fields: FILE_FIELDS });
        const f = (await json(
          token,
          `${UPLOAD}?${params}`,
          { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body },
          fetchImpl,
        )) as DriveFile;
        return text({ created: true, ...view(f) });
      }
      case "trash_file": {
        const id = requireString(args, "file_id");
        const f = (await json(
          token,
          fileUrl(id, { fields: FILE_FIELDS }),
          { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) },
          fetchImpl,
        )) as DriveFile;
        return text({ ok: true, file_id: f.id, name: f.name, trashed: f.trashed === true });
      }
      default:
        return { content: [{ type: "text", text: `unknown Drive tool "${name}"` }], isError: true };
    }
  } catch (e) {
    if (e instanceof DriveError && e.code === 401) throw e; // the hub turns this into "needs sign-in"
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

/** The signed-in account's address, used to label the connection. */
export async function driveAccount(token: TokenSource, fetchImpl: Fetch = fetch): Promise<string> {
  const about = (await json(token, `${API}/about?fields=user(emailAddress)`, { method: "GET" }, fetchImpl)) as {
    user?: { emailAddress?: string };
  };
  return about.user?.emailAddress ?? "";
}
