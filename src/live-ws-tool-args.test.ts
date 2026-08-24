// The deferToolArgs capability on the websocket, which is the hard transport.
//
// A websocket frame is built ONCE and fanned out to every socket subscribed to
// the channel, and the resume ring stores that one frame under one seq. The
// capability, though, belongs to the socket: two browsers on the same session
// can disagree about it, and one of them can be a pinned older build that has
// no idea how to fetch arguments back.
//
// So the builders and the ring keep the full frame and the capability is
// applied per socket on the way out. These tests pin that split, because
// getting it wrong silently strips arguments from a client that cannot ask for
// them again.
import { describe, expect, test } from "bun:test";
import { deferToolArgsInFrame, frameForSocket } from "./live-ws.ts";

const ARGS = '{"command":"grep -n listen_port /etc/app.conf"}';
const call = () => ({ id: "u1", role: "assistant", kind: "tool_use", text: `Bash: ${ARGS}`, ts: 1 });
const prose = () => ({ id: "t1", role: "assistant", kind: "text", text: "Looking now.", ts: 1 });

describe("which frame shapes carry messages", () => {
  test("a delta carrying one message under `message`", () => {
    const frame = { t: "delta", kind: "transcript", key: "s1", seq: 7, delta: { t: "msg", sid: "s1", message: call() } };
    const out = deferToolArgsInFrame(frame) as typeof frame;
    expect((out.delta.message as { text: string }).text).toBe("Bash");
    expect((out.delta.message as { toolArgsLen?: number }).toolArgsLen).toBe(ARGS.length);
    // The envelope is untouched, so ordering and resume still work.
    expect(out.seq).toBe(7);
    expect(out.kind).toBe("transcript");
  });

  test("a delta carrying one message under the short `m`", () => {
    const frame = { t: "delta", delta: { t: "msg", sid: "s1", m: call() } };
    const out = deferToolArgsInFrame(frame) as typeof frame;
    expect((out.delta.m as { text: string }).text).toBe("Bash");
  });

  test("a snapshot carrying a list", () => {
    const frame = { t: "snapshot", kind: "transcript", key: "s1", messages: [prose(), call()] };
    const out = deferToolArgsInFrame(frame) as typeof frame;
    expect(out.messages.map((x) => x.text)).toEqual(["Looking now.", "Bash"]);
  });

  test("a frame with no messages at all is left alone", () => {
    const frame = { t: "busy", kind: "transcript", key: "s1", delta: { t: "busy", busy: true } };
    expect(deferToolArgsInFrame(frame)).toEqual(frame);
  });
});

describe("the original frame is never mutated", () => {
  test("the ring keeps the full arguments after a deferred send", () => {
    // The ring replays this exact object to a client that resumes. If the
    // transform mutated it, a later older client would replay a frame whose
    // arguments had been stripped by an earlier capable one.
    const frame = { t: "delta", delta: { t: "msg", message: call() } };
    deferToolArgsInFrame(frame);
    expect((frame.delta.message as { text: string }).text).toBe(`Bash: ${ARGS}`);
    expect(frame.delta.message).not.toHaveProperty("toolArgsLen");
  });

  test("the deferred copy is a different object", () => {
    const frame = { t: "snapshot", messages: [call()] };
    const out = deferToolArgsInFrame(frame);
    expect(out).not.toBe(frame);
    expect((out as typeof frame).messages).not.toBe(frame.messages);
  });
});

describe("one frame, two sockets, two capabilities", () => {
  const frame = () => ({ t: "delta", kind: "transcript", key: "s1", seq: 3, delta: { t: "msg", message: call() } });

  test("a socket that never declared the capability gets the full arguments", () => {
    const f = frame();
    const out = frameForSocket({ deferToolArgs: false }, f);
    expect(out).toBe(f);
    expect(((out as typeof f).delta.message as { text: string }).text).toBe(`Bash: ${ARGS}`);
  });

  test("an absent capability is treated as absent, not as enabled", () => {
    const f = frame();
    expect(frameForSocket({}, f)).toBe(f);
  });

  test("a capable socket gets the deferred shape from the same frame", () => {
    const f = frame();
    const older = frameForSocket({ deferToolArgs: false }, f);
    const capable = frameForSocket({ deferToolArgs: true }, f);
    expect(((older as typeof f).delta.message as { text: string }).text).toBe(`Bash: ${ARGS}`);
    expect(((capable as typeof f).delta.message as { text: string }).text).toBe("Bash");
  });

  test("order does not matter: the capable socket first still leaves the older one whole", () => {
    const f = frame();
    frameForSocket({ deferToolArgs: true }, f);
    const older = frameForSocket({ deferToolArgs: false }, f);
    expect(((older as typeof f).delta.message as { text: string }).text).toBe(`Bash: ${ARGS}`);
  });

  test("the transform runs once for many capable sockets", () => {
    // Twenty capable sockets on a busy session must not pay twenty transforms
    // of the same frame.
    const f = frame();
    const first = frameForSocket({ deferToolArgs: true }, f);
    for (let i = 0; i < 20; i += 1) {
      expect(frameForSocket({ deferToolArgs: true }, f)).toBe(first);
    }
  });
});
