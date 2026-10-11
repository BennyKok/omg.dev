import { expect, test } from "bun:test";
import { EmptyOpencodeReply, opencodeTurnHasProgress, recoverOpencodeTurn } from "./opencode-turn-recovery";

function setup(errors: Error[], progress = false) {
  const calls: string[] = [];
  let stopped = false;
  const options = {
    request: async () => { calls.push("request"); const error = errors.shift(); if (error) throw error; return "Hello"; },
    abort: async () => { calls.push("abort"); },
    stopped: () => stopped,
    hasProgress: () => progress,
    report: () => { calls.push("log"); },
    pause: async () => { calls.push("pause"); },
  };
  return { options, calls, stop: () => { stopped = true; } };
}

test("an empty greeting retries once after abort, without emitting an error", async () => {
  const { options, calls } = setup([new EmptyOpencodeReply("empty")]);
  expect(await recoverOpencodeTurn(options)).toBe("Hello");
  expect(calls).toEqual(["request", "log", "abort", "pause", "request"]);
});

test("persistent empty replies stop after two attempts", async () => {
  const { options, calls } = setup([new EmptyOpencodeReply("empty"), new EmptyOpencodeReply("empty")]);
  await expect(recoverOpencodeTurn(options)).rejects.toThrow("empty");
  expect(calls.filter(x => x === "request")).toHaveLength(2);
});

for (const reason of ["Unauthorized", "ProviderAuthError", "Request Entity Too Large", "insufficient credits", "invalid model", "quota exceeded"]) {
  test(`does not retry ${reason}`, async () => {
    const { options, calls } = setup([new EmptyOpencodeReply(reason)]);
    await expect(recoverOpencodeTurn(options)).rejects.toThrow(reason);
    expect(calls.filter(x => x === "request")).toHaveLength(1);
  });
}

for (const reason of ["fetch failed", "503 temporarily unavailable", "rate limit exceeded"]) {
  test(`recovers ${reason} before output`, async () => {
    const { options } = setup([new Error(reason)]);
    expect(await recoverOpencodeTurn(options)).toBe("Hello");
  });
}

test("never repeats a turn after text, reasoning, or tool activity", async () => {
  const { options, calls } = setup([new EmptyOpencodeReply("empty")], true);
  await expect(recoverOpencodeTurn(options)).rejects.toThrow("empty");
  expect(calls.filter(x => x === "request")).toHaveLength(1);
});

test("interrupt during backoff stops recovery silently", async () => {
  const { options, calls, stop } = setup([new EmptyOpencodeReply("empty")]);
  options.pause = async () => { stop(); };
  expect(await recoverOpencodeTurn(options)).toBeUndefined();
  expect(calls.filter(x => x === "request")).toHaveLength(1);
});

test("a failed abort prevents replay", async () => {
  const { options, calls } = setup([new EmptyOpencodeReply("empty")]);
  options.abort = async () => { throw new Error("abort failed"); };
  await expect(recoverOpencodeTurn(options)).rejects.toThrow("abort failed");
  expect(calls.filter(x => x === "request")).toHaveLength(1);
});

test("persisted tool activity prevents replay when SSE missed the tool", async () => {
  const { options, calls } = setup([new EmptyOpencodeReply("empty")]);
  const history = [{ info: { role: "assistant", time: { created: 100 } }, parts: [{ type: "tool" }] }];
  await expect(recoverOpencodeTurn({ ...options, hasProgress: async () => opencodeTurnHasProgress(history, 100) })).rejects.toThrow("empty");
  expect(calls.filter(x => x === "request")).toHaveLength(1);
});

test("old turns and user text do not block recovery; current reasoning does", () => {
  const history = [
    { info: { role: "assistant", time: { created: 99 } }, parts: [{ type: "tool" }] },
    { info: { role: "user", time: { created: 100 } }, parts: [{ type: "text", text: "Hi" }] },
    { info: { role: "assistant", time: { created: 100 } }, parts: [{ type: "text", text: " " }] },
  ];
  expect(opencodeTurnHasProgress(history, 100)).toBe(false);
  history.push({ info: { role: "assistant", time: { created: 101 } }, parts: [{ type: "reasoning", text: "thinking" }] });
  expect(opencodeTurnHasProgress(history, 100)).toBe(true);
});
