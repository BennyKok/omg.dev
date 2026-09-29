import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveComputerDir } from "./desktop.ts";

describe("resolveComputerDir", () => {
  test("uses ~/.omg/computer when it is writable, with no warning", () => {
    const warnings: string[] = [];
    const dir = resolveComputerDir({ HOME: "/home/u" }, () => true, (l) => warnings.push(l));
    expect(dir).toBe("/home/u/.omg/computer");
    expect(warnings).toEqual([]);
  });

  test("falls back to the XDG state dir and logs why when ~/.omg is not writable", () => {
    const warnings: string[] = [];
    const dir = resolveComputerDir(
      { HOME: "/home/u" },
      (d) => d !== "/home/u/.omg/computer",
      (l) => warnings.push(l),
    );
    expect(dir).toBe("/home/u/.local/state/omg/computer");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("/home/u/.omg/computer is not writable");
  });

  test("honours XDG_STATE_HOME for the fallback", () => {
    const dir = resolveComputerDir({ HOME: "/home/u", XDG_STATE_HOME: "/state" }, (d) => d.startsWith("/state"), () => {});
    expect(dir).toBe("/state/omg/computer");
  });

  test("a root-owned ~/.omg on disk sends the desktop to the fallback", () => {
    if (process.getuid?.() === 0) return; // root can write anywhere
    const home = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "computer-dir-"));
    try {
      mkdirSync(join(home, ".omg"));
      chmodSync(join(home, ".omg"), 0o555); // what a root-owned 755 dir is to the user
      const warnings: string[] = [];
      const dir = resolveComputerDir({ HOME: home }, undefined, (l) => warnings.push(l));
      expect(dir).toBe(join(home, ".local", "state", "omg", "computer"));
      expect(warnings).toHaveLength(1);
    } finally {
      chmodSync(join(home, ".omg"), 0o755);
      rmSync(home, { recursive: true, force: true });
    }
  });
});
