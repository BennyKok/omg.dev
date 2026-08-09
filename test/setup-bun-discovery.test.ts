// Setup must look where bun actually installs before deciding it is missing.
//
// The check ran BEFORE the line that adds ~/.bun/bin to PATH, so setup died
// with "Bun is required but was not found on PATH" on machines where the very
// next line would have found it. That is the normal state on macOS: bun
// installs to ~/.bun/bin, and setup deliberately does not edit your shell
// profile there, so the login PATH does not include it. Reproduced on a real
// Mac, where `omg setup` was unusable in a plain terminal with bun installed
// and working.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SETUP_SH } from "./setup-script-helpers.ts";

const source = readFileSync(SETUP_SH, "utf8");

function bunBlock(): string {
  const start = source.indexOf("# ---- 2. Bun ----");
  expect(start, "bun block not found").toBeGreaterThanOrEqual(0);
  const end = source.indexOf("BUN_BIN=", start);
  expect(end, "end of bun block not found").toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("finding bun", () => {
  test("PATH is extended before bun is declared missing", () => {
    const block = bunBlock();
    const extend = block.indexOf('export PATH="$HOME/.bun/bin');
    const check = block.indexOf("command -v bun");
    expect(extend).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThanOrEqual(0);
    expect(extend, "the PATH extension must come first, or macOS installs die")
      .toBeLessThan(check);
  });

  test("the standard install location is searched", () => {
    expect(bunBlock()).toContain("$HOME/.bun/bin");
  });

  // Running the installer and then not being able to see what it installed
  // would fail on the line after.
  test("PATH is refreshed after running the installer", () => {
    const block = bunBlock();
    const install = block.indexOf("bun.sh/install");
    const refresh = block.indexOf('export PATH="$HOME/.bun/bin', install);
    expect(refresh, "PATH must be refreshed after installing bun").toBeGreaterThan(install);
  });

  test("the failure message says how to fix it", () => {
    const block = bunBlock();
    expect(block).toContain("curl -fsSL https://bun.sh/install");
    expect(block).toContain("OMG_INSTALL_BUN=1");
  });
});
