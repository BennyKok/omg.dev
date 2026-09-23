// The native Gmail connector against a fake Gmail REST API. Pins what agents
// rely on: readable threads, plain-text bodies, replies that stay in their
// thread, a refreshed token on 401, and no header injection from arguments.
import { expect, test } from "bun:test";
import { buildRawMessage, callGmailTool, gmailAccount, messageText } from "./gmail.ts";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

type Call = { method: string; path: string; body: any; auth: string };

function fakeGmail(opts: { expireFirst?: boolean } = {}) {
  const calls: Call[] = [];
  let first = true;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const path = url.pathname.replace("/gmail/v1/users/me", "") + url.search;
    calls.push({ method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(String(init.body)) : null, auth });
    if (opts.expireFirst && first) {
      first = false;
      return Response.json({ error: { message: "Invalid Credentials" } }, { status: 401 });
    }
    if (url.pathname.endsWith("/threads") && !url.pathname.includes("/threads/")) {
      return Response.json({ threads: [{ id: "t1" }], nextPageToken: "p2" });
    }
    if (url.pathname.endsWith("/threads/t1") && url.searchParams.get("format") === "metadata") {
      return Response.json({
        id: "t1",
        messages: [
          { id: "m1", threadId: "t1", labelIds: ["INBOX"], snippet: "first", payload: { headers: [{ name: "Subject", value: "Lunch" }, { name: "From", value: "a@x.com" }] } },
          { id: "m2", threadId: "t1", labelIds: ["INBOX", "UNREAD"], snippet: "see you", payload: { headers: [{ name: "From", value: "b@x.com" }, { name: "Date", value: "Tue" }] } },
        ],
      });
    }
    if (url.pathname.endsWith("/threads/t1")) {
      return Response.json({
        id: "t1",
        messages: [
          {
            id: "m1",
            threadId: "t1",
            payload: {
              mimeType: "multipart/alternative",
              headers: [{ name: "Subject", value: "Lunch" }, { name: "From", value: "a@x.com" }],
              parts: [
                { mimeType: "text/html", body: { data: b64url("<p>Hi <b>there</b></p>") } },
                { mimeType: "text/plain", body: { data: b64url("Hi there, café?") } },
              ],
            },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/messages/m1")) {
      return Response.json({
        id: "m1",
        threadId: "t1",
        payload: { headers: [{ name: "Subject", value: "Lunch" }, { name: "Message-ID", value: "<abc@mail>" }] },
      });
    }
    if (url.pathname.endsWith("/messages/send")) return Response.json({ id: "sent1", threadId: "t1" });
    if (url.pathname.endsWith("/drafts")) return Response.json({ id: "d1", message: { id: "m9", threadId: "t9" } });
    if (url.pathname.endsWith("/profile")) return Response.json({ emailAddress: "benny@example.com" });
    if (url.pathname.endsWith("/threads/t1/modify")) return Response.json({ id: "t1" });
    if (url.pathname.includes("/threads/missing")) return Response.json({ error: { message: "Requested entity was not found." } }, { status: 404 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const token = async (force?: boolean) => (force ? "fresh" : "stale");
const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);

test("search_threads returns subject, latest sender, unread and a page token", async () => {
  const g = fakeGmail();
  const r = await callGmailTool(token, "search_threads", { query: "from:a", max_results: 99 }, g.fetchImpl);
  expect(r.isError).toBe(false);
  expect(parse(r)).toEqual({
    threads: [{ thread_id: "t1", subject: "Lunch", from: "b@x.com", date: "Tue", messages: 2, unread: true, snippet: "see you" }],
    next_page_token: "p2",
  });
  expect(g.calls[0]!.path).toBe("/threads?maxResults=25&q=from%3Aa");
});

test("get_thread prefers the text/plain part and decodes UTF-8", async () => {
  const g = fakeGmail();
  const r = parse(await callGmailTool(token, "get_thread", { thread_id: "t1" }, g.fetchImpl));
  expect(r.messages[0].body).toBe("Hi there, café?");
  expect(r.messages[0].subject).toBe("Lunch");
});

test("an html-only body is read as text", () => {
  expect(messageText({ mimeType: "text/html", body: { data: b64url("<div>One</div><div>Two &amp; three</div>") } })).toBe("One\nTwo & three");
});

test("a reply stays in the thread and carries In-Reply-To and a Re: subject", async () => {
  const g = fakeGmail();
  const r = parse(await callGmailTool(token, "send_email", { to: "a@x.com", body: "Sounds good", reply_to_message_id: "m1" }, g.fetchImpl));
  expect(r).toEqual({ sent: true, message_id: "sent1", thread_id: "t1" });
  const send = g.calls.find((c) => c.path === "/messages/send")!;
  expect(send.body.threadId).toBe("t1");
  const mime = fromB64url(send.body.raw);
  expect(mime).toContain("To: a@x.com\r\n");
  expect(mime).toContain("Subject: Re: Lunch\r\n");
  expect(mime).toContain("In-Reply-To: <abc@mail>\r\n");
  expect(mime).toContain("References: <abc@mail>\r\n");
  const body = mime.split("\r\n\r\n")[1]!;
  expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Sounds good");
});

test("arguments cannot inject headers, and a non-ASCII subject is encoded", () => {
  const mime = fromB64url(buildRawMessage({ to: "a@x.com\r\nBcc: evil@x.com", subject: "午餐", body: "x" }));
  expect(mime).not.toContain("\r\nBcc: evil@x.com");
  expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from("午餐").toString("base64")}?=`);
});

test("create_draft returns the draft id", async () => {
  const g = fakeGmail();
  expect(parse(await callGmailTool(token, "create_draft", { to: "a@x.com", subject: "Hi", body: "Draft" }, g.fetchImpl))).toEqual({
    draft_id: "d1",
    message_id: "m9",
    thread_id: "t9",
  });
});

test("modify_thread_labels requires a change and posts label ids", async () => {
  const g = fakeGmail();
  expect((await callGmailTool(token, "modify_thread_labels", { thread_id: "t1" }, g.fetchImpl)).isError).toBe(true);
  await callGmailTool(token, "modify_thread_labels", { thread_id: "t1", remove_label_ids: ["INBOX"] }, g.fetchImpl);
  expect(g.calls.at(-1)!.body).toEqual({ addLabelIds: [], removeLabelIds: ["INBOX"] });
});

test("a 401 retries once with a refreshed token", async () => {
  const g = fakeGmail({ expireFirst: true });
  expect(await gmailAccount(token, g.fetchImpl)).toBe("benny@example.com");
  expect(g.calls.map((c) => c.auth)).toEqual(["Bearer stale", "Bearer fresh"]);
});

test("an API error is an error result with Google's message", async () => {
  const g = fakeGmail();
  const r = await callGmailTool(token, "trash_thread", { thread_id: "missing" }, g.fetchImpl);
  expect(r.isError).toBe(true);
  expect(r.content[0]!.text).toContain("not found");
});

test("a non-JSON error page is reported by status, not a parse error", async () => {
  const fetchImpl = (async () => new Response("<html>Bad Gateway</html>", { status: 502 })) as unknown as typeof fetch;
  const r = await callGmailTool(token, "list_labels", {}, fetchImpl);
  expect(r).toEqual({ content: [{ type: "text", text: "Gmail request failed (502)" }], isError: true });
});
