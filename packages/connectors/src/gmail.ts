// omg's own Gmail connector: a small set of agent tools over the Gmail REST
// API (gmail.googleapis.com/gmail/v1).
//
// Google's Gmail MCP server (gmailmcp.googleapis.com) only answers tool calls
// for Cloud projects enrolled in the Workspace Developer Preview Program. The
// REST API is generally available and accepts the same OAuth token, so omg
// signs in against the MCP server's resource metadata (for the scopes) and
// calls REST itself. Tools are few and shaped for agents: plain-text bodies,
// headers flattened, and sending takes fields rather than a raw MIME message.

export interface NativeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface NativeCallResult {
  content: { type: "text"; text: string }[];
  isError: boolean;
}

/** Returns a valid access token. `force` asks for a refreshed one after a 401. */
export type TokenSource = (force?: boolean) => Promise<string>;

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_BODY_CHARS = 20_000;
const MAX_RESULTS = 25;

const str = { type: "string" } as const;
const addressList = { type: "string", description: "Comma-separated email addresses." } as const;

export const GMAIL_TOOLS: NativeTool[] = [
  {
    name: "search_threads",
    description:
      "Search mail with Gmail search syntax (e.g. `from:alice is:unread newer_than:7d`). Returns threads with subject, sender, date and snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query. Empty lists the most recent threads." },
        max_results: { type: "number", description: `1 to ${MAX_RESULTS}. Default 10.` },
        page_token: { type: "string", description: "nextPageToken from a previous call." },
      },
    },
  },
  {
    name: "get_thread",
    description: "Read every message in a thread: headers and the plain-text body.",
    inputSchema: { type: "object", properties: { thread_id: str }, required: ["thread_id"] },
  },
  {
    name: "send_email",
    description:
      "Send an email. To reply, pass reply_to_message_id (the id from get_thread); the reply stays in that thread.",
    inputSchema: {
      type: "object",
      properties: {
        to: addressList,
        subject: str,
        body: { type: "string", description: "Plain-text body." },
        cc: addressList,
        bcc: addressList,
        reply_to_message_id: str,
      },
      required: ["to", "body"],
    },
  },
  {
    name: "create_draft",
    description: "Save an email as a draft without sending it. Same fields as send_email.",
    inputSchema: {
      type: "object",
      properties: {
        to: addressList,
        subject: str,
        body: { type: "string", description: "Plain-text body." },
        cc: addressList,
        bcc: addressList,
        reply_to_message_id: str,
      },
      required: ["body"],
    },
  },
  {
    name: "list_labels",
    description: "List the mailbox labels with their ids (system labels such as INBOX, UNREAD, STARRED, and user labels).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "modify_thread_labels",
    description:
      "Add or remove labels on a thread, by label id. Archive: remove INBOX. Mark read: remove UNREAD. Star: add STARRED.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: str,
        add_label_ids: { type: "array", items: str },
        remove_label_ids: { type: "array", items: str },
      },
      required: ["thread_id"],
    },
  },
  {
    name: "trash_thread",
    description: "Move a thread to the trash. It can be recovered from the trash for 30 days.",
    inputSchema: { type: "object", properties: { thread_id: str }, required: ["thread_id"] },
  },
];

import { scopeHint } from "./drive.ts";

class GmailError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

async function request(token: TokenSource, path: string, init: RequestInit, fetchImpl: Fetch): Promise<unknown> {
  const send = async (force: boolean) =>
    fetchImpl(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await token(force)}`, "Content-Type": "application/json" },
    });
  let res = await send(false);
  // An access token can be revoked or expire early; refresh once and retry.
  if (res.status === 401) res = await send(true);
  const raw = await res.text();
  let body: unknown = {};
  try {
    body = raw ? (JSON.parse(raw) as unknown) : {};
  } catch {
    // A proxy or outage page is not JSON; report the status instead.
    if (res.ok) throw new GmailError("Gmail returned a response that is not JSON");
  }
  if (!res.ok) {
    const message = (body as { error?: { message?: string } }).error?.message ?? `Gmail request failed (${res.status})`;
    throw new GmailError(scopeHint(message), res.status);
  }
  return body;
}

type Header = { name: string; value: string };
type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: Header[] };
type Message = { id: string; threadId: string; labelIds?: string[]; snippet?: string; payload?: Part };

function header(headers: Header[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decode(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function findPart(part: Part | undefined, mime: string): Part | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const hit = findPart(p, mime);
    if (hit) return hit;
  }
  return undefined;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The readable body of a message: text/plain, else text/html as text. */
export function messageText(payload: Part | undefined): string {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decode(plain.body.data);
  const html = findPart(payload, "text/html");
  if (html?.body?.data) return htmlToText(decode(html.body.data));
  return "";
}

function encodeHeader(value: string): string {
  // RFC 2047 for anything outside printable ASCII (e.g. a non-English subject).
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function clean(value: unknown): string {
  // Header values must not carry line breaks: that would inject headers.
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
}

/** Build the base64url RFC 2822 message Gmail's send and draft endpoints take. */
export function buildRawMessage(fields: {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    fields.to ? `To: ${clean(fields.to)}` : "",
    fields.cc ? `Cc: ${clean(fields.cc)}` : "",
    fields.bcc ? `Bcc: ${clean(fields.bcc)}` : "",
    `Subject: ${encodeHeader(clean(fields.subject))}`,
    fields.inReplyTo ? `In-Reply-To: ${clean(fields.inReplyTo)}` : "",
    fields.references ? `References: ${clean(fields.references)}` : "",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const body = Buffer.from(fields.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const mime = `${lines.join("\r\n")}\r\n\r\n${body}`;
  return Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function text(value: unknown): NativeCallResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], isError: false };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new GmailError(`${key} is required`);
  return v.trim();
}

async function outgoing(token: TokenSource, args: Record<string, unknown>, fetchImpl: Fetch) {
  let subject = typeof args.subject === "string" ? args.subject : "";
  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  let references: string | undefined;
  const replyTo = typeof args.reply_to_message_id === "string" ? args.reply_to_message_id.trim() : "";
  if (replyTo) {
    const original = (await request(
      token,
      `/messages/${encodeURIComponent(replyTo)}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`,
      { method: "GET" },
      fetchImpl,
    )) as Message;
    threadId = original.threadId;
    const h = original.payload?.headers;
    inReplyTo = header(h, "Message-ID") || undefined;
    references = [header(h, "References"), inReplyTo].filter(Boolean).join(" ") || undefined;
    const originalSubject = header(h, "Subject");
    if (!subject) subject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
  }
  const raw = buildRawMessage({
    to: typeof args.to === "string" ? args.to : undefined,
    cc: typeof args.cc === "string" ? args.cc : undefined,
    bcc: typeof args.bcc === "string" ? args.bcc : undefined,
    subject,
    body: requireString(args, "body"),
    inReplyTo,
    references,
  });
  return { raw, ...(threadId ? { threadId } : {}) };
}

/** Run one Gmail tool. Errors come back as an error result, not a throw. */
export async function callGmailTool(
  token: TokenSource,
  name: string,
  args: Record<string, unknown>,
  fetchImpl: Fetch = fetch,
): Promise<NativeCallResult> {
  try {
    switch (name) {
      case "search_threads": {
        const max = Math.min(Math.max(Number(args.max_results) || 10, 1), MAX_RESULTS);
        const params = new URLSearchParams({ maxResults: String(max) });
        if (typeof args.query === "string" && args.query.trim()) params.set("q", args.query.trim());
        if (typeof args.page_token === "string" && args.page_token) params.set("pageToken", args.page_token);
        const list = (await request(token, `/threads?${params}`, { method: "GET" }, fetchImpl)) as {
          threads?: { id: string }[];
          nextPageToken?: string;
        };
        const threads = await Promise.all(
          (list.threads ?? []).map(async (t) => {
            const thread = (await request(
              token,
              `/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
              { method: "GET" },
              fetchImpl,
            )) as { id: string; messages?: Message[] };
            const last = thread.messages?.[thread.messages.length - 1];
            const first = thread.messages?.[0];
            return {
              thread_id: thread.id,
              subject: header(first?.payload?.headers, "Subject"),
              from: header(last?.payload?.headers, "From"),
              date: header(last?.payload?.headers, "Date"),
              messages: thread.messages?.length ?? 0,
              unread: thread.messages?.some((m) => m.labelIds?.includes("UNREAD")) ?? false,
              snippet: last?.snippet ?? "",
            };
          }),
        );
        return text({ threads, next_page_token: list.nextPageToken ?? null });
      }
      case "get_thread": {
        const id = requireString(args, "thread_id");
        const thread = (await request(token, `/threads/${encodeURIComponent(id)}?format=full`, { method: "GET" }, fetchImpl)) as {
          id: string;
          messages?: Message[];
        };
        const messages = (thread.messages ?? []).map((m) => {
          const h = m.payload?.headers;
          const body = messageText(m.payload);
          return {
            message_id: m.id,
            from: header(h, "From"),
            to: header(h, "To"),
            cc: header(h, "Cc"),
            date: header(h, "Date"),
            subject: header(h, "Subject"),
            labels: m.labelIds ?? [],
            body: body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n[truncated]` : body,
          };
        });
        return text({ thread_id: thread.id, messages });
      }
      case "send_email": {
        requireString(args, "to");
        const sent = (await request(token, "/messages/send", { method: "POST", body: JSON.stringify(await outgoing(token, args, fetchImpl)) }, fetchImpl)) as Message;
        return text({ sent: true, message_id: sent.id, thread_id: sent.threadId });
      }
      case "create_draft": {
        const draft = (await request(
          token,
          "/drafts",
          { method: "POST", body: JSON.stringify({ message: await outgoing(token, args, fetchImpl) }) },
          fetchImpl,
        )) as { id: string; message?: Message };
        return text({ draft_id: draft.id, message_id: draft.message?.id, thread_id: draft.message?.threadId });
      }
      case "list_labels": {
        const res = (await request(token, "/labels", { method: "GET" }, fetchImpl)) as { labels?: { id: string; name: string; type: string }[] };
        return text({ labels: (res.labels ?? []).map((l) => ({ id: l.id, name: l.name, type: l.type })) });
      }
      case "modify_thread_labels": {
        const id = requireString(args, "thread_id");
        const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
        const add = ids(args.add_label_ids);
        const remove = ids(args.remove_label_ids);
        if (add.length === 0 && remove.length === 0) throw new GmailError("add_label_ids or remove_label_ids is required");
        await request(
          token,
          `/threads/${encodeURIComponent(id)}/modify`,
          { method: "POST", body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) },
          fetchImpl,
        );
        return text({ ok: true, thread_id: id, added: add, removed: remove });
      }
      case "trash_thread": {
        const id = requireString(args, "thread_id");
        await request(token, `/threads/${encodeURIComponent(id)}/trash`, { method: "POST" }, fetchImpl);
        return text({ ok: true, thread_id: id, trashed: true });
      }
      default:
        return { content: [{ type: "text", text: `unknown Gmail tool "${name}"` }], isError: true };
    }
  } catch (e) {
    if (e instanceof GmailError && e.code === 401) throw e; // the hub turns this into "needs sign-in"
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

/** The mailbox address, used to label the account on the connection. */
export async function gmailAccount(token: TokenSource, fetchImpl: Fetch = fetch): Promise<string> {
  const profile = (await request(token, "/profile", { method: "GET" }, fetchImpl)) as { emailAddress?: string };
  return profile.emailAddress ?? "";
}
