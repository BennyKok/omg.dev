import { expect, test } from "bun:test";
import { codecFromSps, keysymOf, parseVideoHeader, voxlCmd } from "./voxl-stream";

test("keys map to X keysyms", () => {
  expect(keysymOf({ code: "KeyA", key: "a" }, false)).toBe(0x61);
  expect(keysymOf({ code: "Enter", key: "Enter" }, false)).toBe(0xff0d);
  expect(keysymOf({ code: "F5", key: "F5" }, false)).toBe(0xffc2);
  expect(keysymOf({ code: "KeyE", key: "é" }, false)).toBe(0xe9);
  expect(keysymOf({ code: "KeyX", key: "€" }, false)).toBe(0x01000000 + 0x20ac);
  expect(keysymOf({ code: "Dead", key: "Dead" }, false)).toBe(0);
});

test("a Mac's Command is Control on the Linux desktop", () => {
  expect(keysymOf({ code: "MetaLeft", key: "Meta" }, true)).toBe(0xffe3);
  expect(keysymOf({ code: "MetaLeft", key: "Meta" }, false)).toBe(0xffeb);
  expect(keysymOf({ code: "ControlRight", key: "Control" }, false)).toBe(0xffe4);
});

test("the codec string comes from the SPS", () => {
  const sps = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x34, 0xac]);
  expect(codecFromSps(sps)).toBe("avc1.640034");
  expect(codecFromSps(new Uint8Array([0, 0, 1, 0x65, 1, 2, 3, 4]))).toBeNull();
});

test("video headers parse", () => {
  const b = new Uint8Array(16);
  b[0] = 0x01; b[1] = 1;
  b[2] = 0; b[3] = 0; b[4] = 1; b[5] = 2; // frame 258
  b[9] = 25; // pipe 2.5 ms
  b[10] = 3; b[12] = 4;
  expect(parseVideoHeader(b)).toEqual({ key: true, frame: 258, pipe: 25, stripe: 3, parts: 4 });
});

test("commands match voxl's wire format", () => {
  expect(voxlCmd.move(10, 20)).toBe("m,10,20");
  expect(voxlCmd.button(3, true)).toBe("b,3,1");
  expect(voxlCmd.scroll(1, -2.25)).toBe("sp,1.0,-2.3");
  expect(voxlCmd.key(0x61, false)).toBe("k,97,0");
});
