import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computerStream, voxlBinary, voxlPort } from "./voxl.ts";

const fakeBin = () => {
  const dir = mkdtempSync(join(tmpdir(), "voxl-test-"));
  const bin = join(dir, "voxl");
  writeFileSync(bin, "#!/bin/sh\n");
  chmodSync(bin, 0o755);
  return { dir, bin };
};

test("the stream stays VNC unless the box opts in", () => {
  const { bin } = fakeBin();
  expect(computerStream({ OMG_VOXL_BIN: bin })).toBe("vnc");
  expect(computerStream({ OMG_COMPUTER_STREAM: "voxl", OMG_VOXL_BIN: bin })).toBe("voxl");
  expect(computerStream({ OMG_COMPUTER_STREAM: " VOXL ", OMG_VOXL_BIN: bin })).toBe("voxl");
});

test("opting in without the binary falls back to VNC", () => {
  expect(computerStream({ OMG_COMPUTER_STREAM: "voxl", OMG_VOXL_BIN: "/nonexistent/voxl" })).toBe("vnc");
  expect(voxlBinary({ OMG_VOXL_BIN: "/nonexistent/voxl" })).toBeNull();
});

test("voxl is found on PATH", () => {
  const { dir, bin } = fakeBin();
  expect(voxlBinary({ PATH: dir, HOME: "/nonexistent" })).toBe(bin);
});

test("a bad port falls back to the default", () => {
  expect(voxlPort({})).toBe(6901);
  expect(voxlPort({ OMG_COMPUTER_VOXL_PORT: "7001" })).toBe(7001);
  expect(voxlPort({ OMG_COMPUTER_VOXL_PORT: "nope" })).toBe(6901);
  expect(voxlPort({ OMG_COMPUTER_VOXL_PORT: "70000" })).toBe(6901);
});
