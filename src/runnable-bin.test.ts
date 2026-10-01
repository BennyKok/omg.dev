import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { isRunnableCommand, whichRunnable } from "./runnable-bin.ts";

function bin(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

describe("whichRunnable", () => {
  test("skips a no-shebang stub and uses the later real binary", () => {
    const root = join(tmpdir(), `runnable-bin-${process.pid}-${Date.now()}`);
    const stubDir = join(root, "stub");
    const realDir = join(root, "real");
    bin(stubDir, "opencode", 'echo "Error: opencode-ai\'s postinstall script was not run."\n');
    const real = bin(realDir, "opencode", "#!/bin/sh\nexit 0\n");
    expect(isRunnableCommand(join(stubDir, "opencode"))).toBe(false);
    expect(isRunnableCommand(real)).toBe(true);
    expect(whichRunnable("opencode", [], { PATH: `${stubDir}:${realDir}` })).toBe(real);
  });

  test("uses an extra candidate when PATH has only the stub", () => {
    const root = join(tmpdir(), `runnable-bin-extra-${process.pid}-${Date.now()}`);
    const stubDir = join(root, "stub");
    const extraDir = join(root, "extra");
    bin(stubDir, "opencode", "echo not a binary\n");
    const extra = bin(extraDir, "opencode", "#!/bin/sh\nexit 0\n");
    expect(whichRunnable("opencode", [extra], { PATH: stubDir })).toBe(extra);
  });

  test("keeps a runnable PATH hit ahead of extras", () => {
    const root = join(tmpdir(), `runnable-bin-order-${process.pid}-${Date.now()}`);
    const pathDir = join(root, "path");
    const extraDir = join(root, "extra");
    const onPath = bin(pathDir, "opencode", "#!/bin/sh\nexit 0\n");
    const extra = bin(extraDir, "opencode", "#!/bin/sh\nexit 0\n");
    expect(whichRunnable("opencode", [extra], { PATH: pathDir })).toBe(onPath);
  });
});
