import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { isBrowserFlowMessage, VOXL_BACKPRESSURE_BYTES, VoxlBridge, voxlVideoFrameId } from "./voxl-bridge.ts";

function video(frame: number): Uint8Array {
  const b = new Uint8Array(20);
  b[0] = 0x01;
  b[2] = (frame >>> 24) & 255; b[3] = (frame >>> 16) & 255; b[4] = (frame >>> 8) & 255; b[5] = frame & 255;
  return b;
}

function harness(buffered = () => 0) {
  const toBrowser: unknown[] = [];
  const toVoxl: unknown[] = [];
  const browser = { send: (m: unknown) => { toBrowser.push(m); return 1; }, close() {} } as unknown as ServerWebSocket<unknown>;
  const bridge = new VoxlBridge(browser, { endpoint: new Promise(() => {}), bufferedAmount: buffered });
  bridge.attach({ readyState: WebSocket.OPEN, send: (m: unknown) => toVoxl.push(m), close() {}, addEventListener() {} } as never);
  return { bridge, toBrowser, toVoxl };
}

test("frame ids parse from video messages only", () => {
  expect(voxlVideoFrameId(video(258))).toBe(258);
  expect(voxlVideoFrameId(new Uint8Array([0x03, 0, 0, 0]))).toBeNull();
});

test("each frame is acked to voxl once, as soon as it arrives", () => {
  const { bridge, toBrowser, toVoxl } = harness();
  bridge.fromVoxl(video(7));
  bridge.fromVoxl(video(7)); // a second stripe of the same frame
  bridge.fromVoxl(video(8));
  expect(toBrowser.length).toBe(3);
  expect(toVoxl).toEqual(["a,7", "a,8"]);
  bridge.close();
});

test("a backed-up browser skips video, then resumes at a keyframe", () => {
  let queued = VOXL_BACKPRESSURE_BYTES + 1;
  const { bridge, toBrowser, toVoxl } = harness(() => queued);
  bridge.fromVoxl(video(1));
  bridge.fromVoxl(video(2));
  expect(toBrowser).toEqual([]);
  expect(toVoxl).toEqual(["a,1", "a,2"]); // voxl keeps its pace
  queued = 0;
  bridge.fromVoxl(video(3)); // delta: still skipped, keyframe requested
  expect(toVoxl).toEqual(["a,1", "a,2", "a,3", "kf"]);
  expect(toBrowser).toEqual([]);
  const key = video(4);
  key[1] = 1;
  bridge.fromVoxl(key);
  bridge.fromVoxl(video(5));
  expect(toBrowser.length).toBe(2);
  bridge.close();
});

test("non-video messages always reach the browser", () => {
  const { bridge, toBrowser } = harness(() => VOXL_BACKPRESSURE_BYTES * 2);
  bridge.fromVoxl(new Uint8Array([0x03, 0, 0, 0]));
  expect(toBrowser.length).toBe(1);
  bridge.close();
});

test("the bridge answers voxl's pings and drops the browser's acks and pongs", () => {
  const { bridge, toBrowser, toVoxl } = harness();
  bridge.fromVoxl('{"s":123456,"t":"ping"}');
  expect(toVoxl).toEqual(["po,123456"]);
  expect(toBrowser).toEqual(['{"s":123456,"t":"ping"}']);
  bridge.write("a,5");
  bridge.write("po,123456");
  bridge.write("m,10,20");
  expect(toVoxl).toEqual(["po,123456", "m,10,20"]);
  expect(isBrowserFlowMessage("kf")).toBe(false);
  bridge.close();
});
