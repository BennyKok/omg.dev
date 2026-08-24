import { describe, expect, test } from "bun:test";

const APP = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
const SERVE = await Bun.file(new URL("../../src/commands/serve.ts", import.meta.url)).text();

const SEND = (() => {
  const start = APP.indexOf("async function sendMessage(");
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf("async function interrupt()", start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
})();

const SERVER_SEND = (() => {
  const start = SERVE.indexOf("function sendPromptToLiveSession(");
  expect(start).toBeGreaterThan(-1);
  const end = SERVE.indexOf("/** Avatar geometry", start);
  expect(end).toBeGreaterThan(start);
  return SERVE.slice(start, end);
})();

describe("a composer send during a live turn", () => {
  test("an ordinary tap interrupts and is not marked queued", () => {
    expect(SEND).toContain('const queuedBehindTurn = mode === "queue" && chatBusy;');
    expect(SEND).toContain('mode: "steer" | "queue" = "steer"');
    expect(SEND).toContain('{ body: { mode } }');
    const interrupt = SERVER_SEND.indexOf('=== "steer" && session.busy');
    expect(interrupt).toBeGreaterThan(-1);
    expect(SERVER_SEND.indexOf("interruptLiveSession(session)")).toBeGreaterThan(interrupt);
    expect(SERVER_SEND.indexOf('appendAisdkCmd(key, { type: "send"')).toBeGreaterThan(interrupt);
    expect(SERVER_SEND.indexOf("enqueueMessage(sid, transportPrompt")).toBeGreaterThan(interrupt);
  });
});
