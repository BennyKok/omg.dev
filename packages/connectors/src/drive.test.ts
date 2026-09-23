// The native Drive connector against a fake Drive REST API. Pins what agents
// rely on: search that escapes their text, Google files read as text, binary
// files not dumped, a created file with the right metadata, and a refreshed
// token on 401.
import { expect, test } from "bun:test";
import { buildSearchQuery, callDriveTool, driveAccount, driveLiteral, scopeHint } from "./drive.ts";

type Call = { method: string; url: URL; body: string; headers: Headers };

const DOC = { id: "d1", name: "Plan", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-09-01T00:00:00Z", webViewLink: "https://docs/d1", owners: [{ emailAddress: "a@x.com" }] };
const SHEET = { id: "s1", name: "Numbers", mimeType: "application/vnd.google-apps.spreadsheet" };
const PDF = { id: "p1", name: "Scan.pdf", mimeType: "application/pdf", size: "2048", webViewLink: "https://drive/p1" };
const NOTE = { id: "n1", name: "notes.md", mimeType: "text/markdown" };
const FILES: Record<string, Record<string, unknown>> = { d1: DOC, s1: SHEET, p1: PDF, n1: NOTE };

function fakeDrive(opts: { expireFirst?: boolean } = {}) {
  const calls: Call[] = [];
  let first = true;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", url, body: String(init?.body ?? ""), headers: new Headers(init?.headers) });
    if (opts.expireFirst && first) {
      first = false;
      return Response.json({ error: { message: "Invalid Credentials" } }, { status: 401 });
    }
    const p = url.pathname;
    if (p === "/drive/v3/about") return Response.json({ user: { emailAddress: "benny@example.com" } });
    if (p === "/drive/v3/files") return Response.json({ files: [DOC, PDF], nextPageToken: "next" });
    if (p === "/upload/drive/v3/files") return Response.json({ id: "new1", name: "Report", mimeType: "application/vnd.google-apps.document" });
    const exp = p.match(/^\/drive\/v3\/files\/(\w+)\/export$/);
    if (exp) return new Response(exp[1] === "s1" ? "a,b\n1,2" : "Hello from\r\nthe doc");
    const one = p.match(/^\/drive\/v3\/files\/(\w+)$/);
    if (one) {
      const f = FILES[one[1]!];
      if (!f) return Response.json({ error: { message: "File not found: x." } }, { status: 404 });
      if (url.searchParams.get("alt") === "media") return new Response("# notes\nline");
      if (init?.method === "PATCH") return Response.json({ ...f, trashed: true });
      return Response.json(f);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  let refreshed = false;
  const token = async (force?: boolean) => {
    if (force) refreshed = true;
    return force ? "fresh" : "stale";
  };
  return { calls, fetchImpl, token, wasRefreshed: () => refreshed };
}

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);

test("search escapes the agent's text and skips trashed files", () => {
  expect(driveLiteral("it's a\\b")).toBe("'it\\'s a\\\\b'");
  expect(buildSearchQuery({ text: "Q3 plan", folder_id: "f1" })).toBe("trashed = false and fullText contains 'Q3 plan' and 'f1' in parents");
  expect(buildSearchQuery({})).toBe("trashed = false");
});

test("search_files lists recent files without text, and drops orderBy with a full-text search", async () => {
  const d = fakeDrive();
  const recent = parse(await callDriveTool(d.token, "search_files", {}, d.fetchImpl));
  expect(recent.files.map((f: { name: string }) => f.name)).toEqual(["Plan", "Scan.pdf"]);
  expect(recent.next_page_token).toBe("next");
  expect(d.calls[0]!.url.searchParams.get("orderBy")).toBe("modifiedTime desc");

  await callDriveTool(d.token, "search_files", { text: "plan" }, d.fetchImpl);
  expect(d.calls[1]!.url.searchParams.get("orderBy")).toBeNull();
  expect(d.calls[1]!.url.searchParams.get("q")).toContain("fullText contains 'plan'");
});

test("read_file exports Docs as text and Sheets as CSV, reads text uploads, and never dumps a binary", async () => {
  const d = fakeDrive();
  const doc = parse(await callDriveTool(d.token, "read_file", { file_id: "d1" }, d.fetchImpl));
  expect(doc.content).toBe("Hello from\nthe doc");
  expect(d.calls[1]!.url.searchParams.get("mimeType")).toBe("text/plain");

  const sheet = parse(await callDriveTool(d.token, "read_file", { file_id: "s1" }, d.fetchImpl));
  expect(sheet.content).toBe("a,b\n1,2");

  const note = parse(await callDriveTool(d.token, "read_file", { file_id: "n1" }, d.fetchImpl));
  expect(note.content).toBe("# notes\nline");

  const pdf = parse(await callDriveTool(d.token, "read_file", { file_id: "p1" }, d.fetchImpl));
  expect(pdf.content).toBeNull();
  expect(pdf.link).toBe("https://drive/p1");
  expect(d.calls.filter((c) => c.url.pathname.endsWith("/p1") && c.url.searchParams.get("alt") === "media")).toHaveLength(0);
});

test("create_file uploads multipart metadata and content, converting to a Google Doc on request", async () => {
  const d = fakeDrive();
  const made = parse(await callDriveTool(d.token, "create_file", { name: "Report", content: "Body ü", as_google_doc: true, folder_id: "f1" }, d.fetchImpl));
  expect(made.created).toBe(true);
  const call = d.calls[0]!;
  expect(call.url.searchParams.get("uploadType")).toBe("multipart");
  expect(call.headers.get("content-type")).toStartWith("multipart/related; boundary=");
  expect(call.body).toContain('{"name":"Report","mimeType":"application/vnd.google-apps.document","parents":["f1"]}');
  expect(call.body).toContain("Content-Type: text/plain; charset=UTF-8\r\n\r\nBody ü");
});

test("trash_file patches trashed, and errors come back as results", async () => {
  const d = fakeDrive();
  const trashed = parse(await callDriveTool(d.token, "trash_file", { file_id: "d1" }, d.fetchImpl));
  expect(trashed).toMatchObject({ ok: true, trashed: true });
  expect(d.calls[0]!.method).toBe("PATCH");

  const missing = await callDriveTool(d.token, "get_file", { file_id: "zz" }, d.fetchImpl);
  expect(missing.isError).toBe(true);
  expect(missing.content[0]!.text).toBe("File not found: x.");
  expect((await callDriveTool(d.token, "read_file", {}, d.fetchImpl)).content[0]!.text).toBe("file_id is required");
});

test("a 401 refreshes the token once and retries; the account is the Drive user", async () => {
  const d = fakeDrive({ expireFirst: true });
  expect(await driveAccount(d.token, d.fetchImpl)).toBe("benny@example.com");
  expect(d.wasRefreshed()).toBe(true);
  expect(d.calls.map((c) => c.headers.get("authorization"))).toEqual(["Bearer stale", "Bearer fresh"]);
});

test("a token without the ticked permissions says how to fix it", () => {
  expect(scopeHint("Request had insufficient authentication scopes.")).toContain("tick every permission box");
  expect(scopeHint("File not found")).toBe("File not found");
});
