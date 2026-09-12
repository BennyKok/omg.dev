// The `workRows` capability on the wire.
//
// The fold itself is covered in transcript-rows.test.ts. This covers the
// contract a connection sees: it is OPT IN, so a socket that never asks gets
// the raw stream byte for byte; a socket that asks gets its snapshot folded,
// the open run continued step by step under one id, and a display call
// handed to its artifact — with exactly one frame keeping the seq, so a
// client's resume cursor never skips a frame it needed.
import { describe, expect, test } from "bun:test";
import { framesForSocket, type WorkRowsState } from "./live-ws.ts";

type Wire = { id: string; role: string; kind: string; text: string; ts: number; steps?: Wire[]; tool?: Wire };

let ts = 0;
const m = (kind: string, text = "", id?: string): Wire => {
  ts += 1;
  return { id: id ?? `${kind}-${ts}`, role: "assistant", kind, text, ts };
};

const SID = "11111111-1111-4111-8111-111111111111";
const channel = { kind: "transcript", key: SID };
let seq = 0;
const snapshot = (messages: Wire[]) => ({ t: "snapshot", ...channel, sid: SID, seq: ++seq, messages, nextBefore: null });
const delta = (message: Wire) => ({ t: "delta", ...channel, seq: ++seq, delta: { t: "msg", sid: SID, message } });
const sent = (frame: Record<string, unknown>) => (frame.delta as { message: Wire }).message;

describe("a socket that did not ask", () => {
  test("receives the frame it was given, untouched", () => {
    const frame = delta(m("tool_use", "Bash: ls"));
    expect(framesForSocket({ deferToolArgs: false, workRows: null }, frame)).toEqual([frame]);
    const snap = snapshot([m("thinking", "plan"), m("tool_use", "Bash: ls")]);
    expect(framesForSocket({ deferToolArgs: false }, snap)).toEqual([snap]);
  });
});

describe("a socket that asked", () => {
  const capable = (): { deferToolArgs: boolean; workRows: WorkRowsState } => ({ deferToolArgs: false, workRows: new Map() });

  test("gets its snapshot folded, and the next step continues the run it ended with", () => {
    const state = capable();
    const opening = m("thinking", "plan");
    const bash = m("tool_use", "Bash: ls");
    const [snap] = framesForSocket(state, snapshot([m("text", "hi"), opening, bash]));
    const rows = snap!.messages as Wire[];
    expect(rows.map((row) => row.kind)).toEqual(["text", "work"]);
    expect(rows[1]!.id).toBe(opening.id);
    const step = m("tool_use", "Read: x");
    const frame = delta(step);
    const out = framesForSocket(state, frame);
    expect(out).toHaveLength(1);
    expect(out[0]!.seq).toBe(frame.seq);
    expect(sent(out[0]!).id).toBe(opening.id);
    expect(sent(out[0]!).steps!.map((s) => s.id)).toEqual([opening.id, bash.id, step.id]);
  });

  test("a message that closes the run goes out alone; the next step opens a new row", () => {
    const state = capable();
    framesForSocket(state, snapshot([m("tool_use", "Bash: ls")]));
    const text = m("text", "done");
    const out = framesForSocket(state, delta(text));
    expect(out).toHaveLength(1);
    expect(sent(out[0]!)).toBe(text);
    const fresh = m("tool_use", "Bash: pwd");
    expect(sent(framesForSocket(state, delta(fresh))[0]!).id).toBe(fresh.id);
  });

  test("an artifact takes its display call: two frames, and only the last keeps the seq", () => {
    const state = capable();
    framesForSocket(state, snapshot([]));
    const bash = m("tool_use", "Bash: ls");
    const call = m("tool_use", "mcp__omg__omg_display_image: shot.png");
    framesForSocket(state, delta(bash));
    framesForSocket(state, delta(call));
    const image = m("image", "shot", "artifact-7");
    const frame = delta(image);
    const out = framesForSocket(state, frame);
    expect(out).toHaveLength(2);
    expect(out[0]!.seq).toBeUndefined();
    expect(sent(out[0]!).id).toBe(bash.id);
    expect(sent(out[0]!).steps!.map((s) => s.id)).toEqual([bash.id]);
    expect(out[1]!.seq).toBe(frame.seq);
    expect(sent(out[1]!).id).toBe(image.id);
    expect(sent(out[1]!).tool!.id).toBe(call.id);
  });

  test("a run that held only the display call is withdrawn", () => {
    const state = capable();
    const call = m("tool_use", "omg_display_file: a.pdf");
    framesForSocket(state, delta(call));
    const out = framesForSocket(state, delta(m("file", "a", "artifact-8")));
    expect(out).toHaveLength(2);
    expect(sent(out[0]!).id).toBe(call.id);
    expect(sent(out[0]!).steps).toEqual([]);
    expect(sent(out[1]!).tool!.id).toBe(call.id);
  });

  test("an older page folds but does not become the open run", () => {
    const state = capable();
    framesForSocket(state, snapshot([m("text", "latest")]));
    const [page] = framesForSocket(state, { t: "batch", sid: SID, seq: ++seq, messages: [m("tool_use", "Bash: old")] });
    expect((page!.messages as Wire[]).map((row) => row.kind)).toEqual(["work"]);
    const fresh = m("tool_use", "Bash: new");
    const out = framesForSocket(state, delta(fresh));
    expect(sent(out[0]!).id).toBe(fresh.id);
    expect(sent(out[0]!).steps).toHaveLength(1);
  });

  test("with deferral too, the calls inside a row and on an artifact carry names only", () => {
    const state = { ...capable(), deferToolArgs: true };
    const bash = m("tool_use", 'Bash: {"command":"ls"}');
    const [row] = framesForSocket(state, delta(bash));
    const step = sent(row!).steps![0]!;
    expect(step.text).toBe("Bash");
    expect((step as { toolArgsLen?: number }).toolArgsLen).toBe('{"command":"ls"}'.length);
    const call = m("tool_use", 'omg_display_image: {"path":"shot.png"}');
    framesForSocket(state, delta(call));
    const out = framesForSocket(state, delta(m("image", "shot", "artifact-9")));
    expect(sent(out[1]!).tool!.text).toBe("omg_display_image");
  });

  test("the raw frame is never mutated, so the resume ring stays canonical", () => {
    const state = capable();
    const frame = delta(m("tool_use", "Bash: ls"));
    const before = JSON.stringify(frame);
    framesForSocket(state, frame);
    expect(JSON.stringify(frame)).toBe(before);
  });
});
