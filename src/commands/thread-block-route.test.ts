import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import { startThread, threadAuthor, threadParticipantId, appendThreadMessage } from "../threads.ts";
import { blockedThreadParticipants } from "../thread-blocks.ts";
import { handleThreadRequest } from "./serve.ts";

const original = PATHS.data;
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "thread-block-route-")); PATHS.data = dir; });
afterEach(() => { PATHS.data = original; rmSync(dir, { recursive: true, force: true }); });

test("the managed receiver owns their block even if body and URL name someone else", async () => {
  const thread = startThread({ identity: "receiver@example.com" });
  const sender = threadAuthor(thread.id, "sender@example.com");
  if (sender.kind !== "human") throw new Error("Expected human");
  appendThreadMessage(thread.id, { author: sender, text: "Hidden content" });
  const url = new URL(`http://local/api/threads/${thread.id}/blocks?user=other@example.com`);
  const request = new Request(url.toString(), { method: "POST", headers: { "x-omg-viewer-email": "receiver@example.com" }, body: JSON.stringify({ participantId: sender.participantId, blocked: true, user: "other@example.com" }) });
  expect((await handleThreadRequest(request, url, url.pathname))?.status).toBe(200);
  expect(blockedThreadParticipants(threadParticipantId("receiver@example.com"))).toEqual([sender.participantId]);
  expect(blockedThreadParticipants(threadParticipantId("other@example.com"))).toEqual([]);
  const listUrl = new URL("http://local/api/threads?user=other@example.com");
  const response = await handleThreadRequest(new Request(listUrl.toString(), { headers: request.headers }), listUrl, listUrl.pathname);
  expect(((await response!.json()) as { threads: { lastMessage: unknown }[] }).threads[0].lastMessage).toBeNull();
});

test("blocks require a real human member and an explicit boolean", async () => {
  const thread = startThread({ identity: "receiver@example.com" });
  const url = new URL(`http://local/api/threads/${thread.id}/blocks`);
  for (const body of [null, { participantId: "omg", blocked: true }, { participantId: threadParticipantId("receiver@example.com"), blocked: true }, { participantId: "human:unknown", blocked: true }]) {
    const req = new Request(url.toString(), { method: "POST", headers: { "x-omg-viewer-email": "receiver@example.com" }, body: JSON.stringify(body) });
    expect((await handleThreadRequest(req, url, url.pathname))?.status).toBe(400);
  }
});
