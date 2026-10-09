import { expect, test } from "bun:test";
import { LocalDictationStream } from "../src/omg/local-dictation-stream";

test("buffers short chunks, preserves committed words, and flushes a short tail", async () => {
  const pcm: string[] = []; const shown: string[][] = [];
  const stream = new LocalDictationStream({
    process: async bytes => { pcm.push(bytes); return { text: pcm.length === 1 ? "hello" : "", pending: "world" }; },
    stop: async () => ({ text: "world", pending: "" }),
  }, (text, pending) => shown.push([text, pending]));
  stream.push(new Uint8Array(3_200)); await Promise.resolve(); expect(pcm.length).toBe(0);
  stream.push(new Uint8Array(28_800)); await new Promise(resolve => setTimeout(resolve, 0));
  expect(shown).toEqual([["hello", "world"]]);
  stream.push(new Uint8Array([255, 127, 0, 128]));
  expect(await stream.finish()).toBe("hello world");
  expect(Buffer.from(pcm[0]!, "base64").length).toBe(32_000);
  expect(Buffer.from(pcm[1]!, "base64")).toEqual(Buffer.from([255, 127, 0, 128]));
  expect(shown.at(-1)).toEqual(["hello world", ""]);
  expect(await stream.finish()).toBe("hello world");
});
test("cancel ignores an in-flight result, skips queued audio, and closes once", async () => {
  let resolve!: (value: { text: string; pending: string }) => void;
  let calls = 0; let stops = 0; const shown: string[] = [];
  const stream = new LocalDictationStream({
    process: () => { calls++; return new Promise(r => { resolve = r; }); },
    stop: async () => { stops++; return { text: "discard", pending: "" }; },
  }, text => shown.push(text));
  stream.push(new Uint8Array(64_000)); await Promise.resolve();
  const cancelled = stream.cancel(); resolve({ text: "late", pending: "words" });
  expect(await cancelled).toBe(""); expect(shown).toEqual([]); expect(calls).toBe(1); expect(stops).toBe(1);
  stream.push(new Uint8Array(32_000)); await stream.cancel(); expect(stops).toBe(1);
});
test("an inference failure releases the native stream before batch recovery", async () => {
  let stopped = false;
  const stream = new LocalDictationStream({ process: async () => { throw Error("inference failed"); },
    stop: async () => { stopped = true; return { text: "", pending: "" }; },
  }, () => {});
  stream.push(new Uint8Array(32_000));
  await expect(stream.finish()).rejects.toThrow("inference failed");
  expect(stopped).toBe(true); expect(await stream.cancel()).toBe("");
});
