import { describe, expect, test } from "bun:test";
import {
  FRAME_DATA,
  FRAME_JSON,
  FrameDecoder,
  MAX_FRAME_BYTES,
  dataFrame,
  jsonFrame,
  sanitizeTermId,
  termIdFromQuery,
} from "./protocol.ts";

describe("frames", () => {
  test("survive any split and join of the byte stream", () => {
    const bytes = new Uint8Array([
      ...jsonFrame({ op: "ping" }),
      ...dataFrame(new TextEncoder().encode("héllo\x1b[0m")),
      ...jsonFrame({ op: "resize", cols: 80, rows: 24 }),
    ]);
    for (const step of [1, 2, 3, 7, bytes.length]) {
      const dec = new FrameDecoder();
      const frames = [];
      for (let i = 0; i < bytes.length; i += step) frames.push(...dec.push(bytes.slice(i, i + step)));
      expect(frames.map((f) => f.kind)).toEqual([FRAME_JSON, FRAME_DATA, FRAME_JSON]);
      expect(frames[0]).toEqual({ kind: FRAME_JSON, message: { op: "ping" } });
      const data = frames[1];
      expect(data.kind === FRAME_DATA && new TextDecoder().decode(data.data)).toBe("héllo\x1b[0m");
    }
  });

  test("a malformed stream is refused, not buffered forever", () => {
    expect(() => new FrameDecoder().push(new Uint8Array([9, 0, 0, 0, 0]))).toThrow("bad frame kind");
    const huge = new Uint8Array(5);
    huge[0] = FRAME_DATA;
    new DataView(huge.buffer).setUint32(1, MAX_FRAME_BYTES + 1);
    expect(() => new FrameDecoder().push(huge)).toThrow("too large");
    const notOp = new TextEncoder().encode(JSON.stringify({ nope: 1 }));
    const frame = new Uint8Array(5 + notOp.length);
    frame[0] = FRAME_JSON;
    new DataView(frame.buffer).setUint32(1, notOp.length);
    frame.set(notOp, 5);
    expect(() => new FrameDecoder().push(frame)).toThrow("bad control frame");
  });
});

describe("terminal ids", () => {
  const id = (q: string) => termIdFromQuery(new URLSearchParams(q));

  test("a session's first tab is its scope; later tabs add a suffix", () => {
    expect(id("sessionId=0f3c-11aa")).toBe("s-0f3c-11aa");
    expect(id("sessionId=0f3c-11aa&tab=t2")).toBe("s-0f3c-11aa-t2");
  });

  test("global shells keep their name; the session namespace is not reachable by name", () => {
    expect(id("")).toBe("main");
    expect(id("session=login-claude")).toBe("login-claude");
    expect(id("session=main&tab=tk1")).toBe("main-tk1");
    expect(id("session=s-0f3c")).toBeNull();
  });

  test("hostile or oversized names are rejected, not rewritten into another shell", () => {
    expect(id("session=../etc")).toBeNull();
    expect(id("session=a b")).toBeNull();
    expect(id("sessionId=abc&tab=../x")).toBeNull();
    expect(sanitizeTermId("x".repeat(97))).toBeNull();
    expect(sanitizeTermId("x".repeat(96))).toBe("x".repeat(96));
  });
});
