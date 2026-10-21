import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { useState } from "react";
import type { OmgTransport } from "@omg-dev/client";
import type { OmgChatMessage, OmgMessage } from "./omg-chat-transport";
const { configureOmgTransport } = await import("./omg-client");
const { useSessionHistory } = await import("./use-session-history");
const { clearTranscriptCache, readTranscriptCache, writeTranscriptCache } = await import("./transcript-cache");
const { omgMessagesToUIMessages } = await import("./omg-chat-transport");

type Page = { messages: OmgMessage[]; nextBefore: number | null };
const requests: { path: string; resolve: (page: Page) => void; reject: (error: Error) => void }[] = [];
const errors: (string | null)[] = [];
const onError = (error: string | null) => { errors.push(error); };
configureOmgTransport({
  request: (path: string) => new Promise((resolve, reject) => { requests.push({ path, resolve, reject }); }),
} as unknown as OmgTransport);
let ui: Mounted;
let history: ReturnType<typeof useSessionHistory>;
let changeMessages: (fn: (current: OmgChatMessage[]) => OmgChatMessage[]) => void;
let session = 0;
const row = (id: string, text = id): OmgMessage => ({ id, role: "assistant", kind: "text", text, ts: 1 });
function Probe({ sid }: { sid: string }) {
  const [messages, setMessages] = useState<OmgChatMessage[]>([]);
  changeMessages = setMessages;
  history = useSessionHistory(sid, setMessages, onError);
  return <div><span>{history.loading ? "Loading transcript" : "Ready"}</span>
    {messages.map(message => <p key={message.id}>{message.metadata?.omgMessage?.text}</p>)}
  </div>;
}
function open() {
  const sid = `history-${++session}`;
  ui = mount();
  ui.render(<Probe sid={sid} />);
  return sid;
}
afterEach(() => { ui?.cleanup(); clearTranscriptCache(); requests.length = 0; errors.length = 0; });

test("paints a live history snapshot while the HTTP read is still pending, and ignores its stale result", async () => {
  const sid = open();
  expect(ui.text()).toContain("Loading transcript");
  const http = requests[0]!;
  ui.flush(() => history.applySnapshot({ messages: [row("saved", "Current answer")], nextBefore: 40 }));
  expect(ui.text()).toContain("ReadyCurrent answer");
  expect(ui.text()).not.toContain("Loading transcript");
  expect(readTranscriptCache(sid)?.nextBefore).toBe(40);
  await ui.flushAsync(() => { http.resolve({ messages: [row("old", "Stale answer")], nextBefore: null }); });
  expect(ui.text()).toContain("Current answer");
  expect(ui.text()).not.toContain("Stale answer");
});

test("a failed HTTP read does not report an error after live history succeeded", async () => {
  open();
  const http = requests[0]!;
  ui.flush(() => history.applySnapshot({ messages: [row("live")], nextBefore: null }));
  await ui.flushAsync(() => { http.reject(new Error("slow read failed")); });
  expect(errors).toEqual([]);
  expect(ui.text()).toContain("Readylive");
});

test("HTTP still loads the chat when no live snapshot arrives", async () => {
  open();
  await ui.flushAsync(() => { requests[0]!.resolve({ messages: [row("http answer")], nextBefore: null }); });
  expect(ui.text()).toContain("Readyhttp answer");
  await ui.flushAsync(async () => { expect(await history.loadOlderMessages()).toBe(false); });
  expect(requests).toHaveLength(1);
});

test("an empty live history ends the loading state", () => {
  open();
  ui.flush(() => history.applySnapshot({ messages: [], nextBefore: null }));
  expect(ui.text()).toBe("Ready");
});

test("a cached conversation paints while revalidation is pending", () => {
  const sid = `history-${++session}`;
  writeTranscriptCache(sid, omgMessagesToUIMessages([row("cached")]), 40);
  ui = mount();
  ui.render(<Probe sid={sid} />);
  expect(ui.text()).toContain("Readycached");
});

test("switching sessions ignores the old HTTP read", async () => {
  open();
  const old = requests[0]!;
  const sid = `history-${++session}`;
  ui.render(<Probe sid={sid} />);
  ui.flush(() => history.applySnapshot({ messages: [row("new conversation")], nextBefore: null }));
  await ui.flushAsync(() => { old.resolve({ messages: [row("wrong conversation")], nextBefore: null }); });
  expect(ui.text()).toContain("new conversation");
  expect(ui.text()).not.toContain("wrong conversation");
});

test("a refreshed live tail retains older loaded pages and their cursor without duplicates", async () => {
  const sid = open();
  ui.flush(() => history.applySnapshot({ messages: [row("tail")], nextBefore: 40 }));
  let older: Promise<boolean>;
  ui.flush(() => { older = history.loadOlderMessages(); });
  expect(requests[1]!.path).toContain("before=40");
  await ui.flushAsync(async () => {
    requests[1]!.resolve({ messages: [row("older"), row("tail")], nextBefore: 20 });
    await older!;
  });
  ui.flush(() => history.applySnapshot({ messages: [row("tail"), row("new")], nextBefore: 41 }));
  expect(ui.queryAll("p").map(el => el.textContent)).toEqual(["older", "tail", "new"]);
  expect(readTranscriptCache(sid)?.nextBefore).toBe(20);
  ui.flush(() => { void history.loadOlderMessages(); });
  expect(requests[2]!.path).toContain("before=20");
});

test("messages received during HTTP loading survive the history merge", async () => {
  open();
  ui.flush(() => changeMessages(current => [...current, ...omgMessagesToUIMessages([row("new live answer")])]));
  await ui.flushAsync(() => { requests[0]!.resolve({ messages: [row("saved")], nextBefore: null }); });
  expect(ui.queryAll("p").map(el => el.textContent)).toEqual(["saved", "new live answer"]);
});


test("a live refresh during an older-page read does not stop pagination", async () => {
  open();
  ui.flush(() => history.applySnapshot({ messages: [row("tail")], nextBefore: 40 }));
  let older: Promise<boolean>;
  ui.flush(() => { older = history.loadOlderMessages(); });
  ui.flush(() => history.applySnapshot({ messages: [row("tail"), row("new")], nextBefore: 40 }));
  await ui.flushAsync(async () => {
    requests[1]!.resolve({ messages: [row("older")], nextBefore: 20 });
    expect(await older!).toBe(true);
  });
  expect(ui.queryAll("p").map(el => el.textContent)).toEqual(["older", "tail", "new"]);
});
