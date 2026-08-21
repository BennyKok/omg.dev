import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCursorChat } from "./tmux.ts";

const CHAT_ID = "f0acc02d-2751-4007-a294-3ec8c6afbc31";

/** A stand-in for `cursor-agent create-chat`, so no Cursor install is needed. */
function fakeCursorAgent(body: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "cursor-create-chat-"));
  const script = join(dir, "fake-cursor-agent.sh");
  writeFileSync(script, `#!/bin/sh\n${body}\n`);
  chmodSync(script, 0o755);
  return [script];
}

describe("createCursorChat", () => {
  test("returns the chat id from a process that prints it and NEVER exits", async () => {
    // The regression. `cursor-agent create-chat` emits the id and then keeps
    // running forever. The old code used Bun.spawnSync, which waits for exit,
    // so it blocked the serve process's main thread — and with it every HTTP
    // request, not just cursor's — until the service was restarted.
    const cmd = fakeCursorAgent(`echo ${CHAT_ID}\nwhile true; do sleep 1; done`);
    const started = performance.now();
    const result = await createCursorChat(process.cwd(), { cmd, timeoutMs: 10_000 });
    const elapsed = performance.now() - started;

    expect(result.nativeSessionId).toBe(CHAT_ID);
    expect(result.error).toBeUndefined();
    // Resolved on the id, not on exit (which never comes) and not on timeout.
    expect(elapsed).toBeLessThan(5_000);
  });

  test("still works when the process prints the id and exits normally", async () => {
    const cmd = fakeCursorAgent(`echo ${CHAT_ID}`);
    const result = await createCursorChat(process.cwd(), { cmd, timeoutMs: 10_000 });
    expect(result.nativeSessionId).toBe(CHAT_ID);
  });

  test("surfaces stderr when the allocator fails", async () => {
    const cmd = fakeCursorAgent(`echo "not logged in" >&2\nexit 1`);
    const result = await createCursorChat(process.cwd(), { cmd, timeoutMs: 10_000 });
    expect(result.nativeSessionId).toBeUndefined();
    expect(result.error).toContain("not logged in");
  });

  test("gives up after the timeout instead of hanging forever", async () => {
    const cmd = fakeCursorAgent("while true; do sleep 1; done");
    const started = performance.now();
    const result = await createCursorChat(process.cwd(), { cmd, timeoutMs: 250 });
    const elapsed = performance.now() - started;

    expect(result.nativeSessionId).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(elapsed).toBeLessThan(5_000);
  });

  test("does not leave the child process running", async () => {
    const cmd = fakeCursorAgent(`echo ${CHAT_ID}\nwhile true; do sleep 1; done`);
    const result = await createCursorChat(process.cwd(), { cmd, timeoutMs: 10_000 });
    expect(result.nativeSessionId).toBe(CHAT_ID);

    // The allocator is killed in the `finally` — only the chat id outlives it.
    const still = Bun.spawnSync(["pgrep", "-f", cmd[0]!]);
    expect(still.exitCode).not.toBe(0);
  });
});
