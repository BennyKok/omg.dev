import { describe, expect, test } from "bun:test";
import { findInstall, forwardToInstall } from "./forward.ts";

describe("findInstall", () => {
  test("prefers lfg on PATH so it cannot recurse into this wrapper", () => {
    expect(
      findInstall({
        which: (name) => (name === "lfg" ? "/opt/lfg" : "/opt/omg"),
        exists: () => true,
      }),
    ).toBe("/opt/lfg");
  });

  test("falls back to ~/.local/bin/lfg when PATH has no lfg", () => {
    expect(
      findInstall({
        which: () => null,
        exists: (path) => path === "/home/x/.local/bin/lfg",
        homedir: () => "/home/x",
      }),
    ).toBe("/home/x/.local/bin/lfg");
  });

  test("returns null when nothing is installed", () => {
    expect(
      findInstall({
        which: () => null,
        exists: () => false,
        homedir: () => "/home/x",
      }),
    ).toBeNull();
  });
});

describe("forwardToInstall", () => {
  test("spawns the install with the caller's argv", async () => {
    const spawned: string[][] = [];
    const result = await forwardToInstall(["mcp"], {
      which: () => "/tmp/lfg",
      spawn: async (argv) => {
        spawned.push(argv);
        return 3;
      },
    });
    expect(result).toEqual({ forwarded: true, exitCode: 3, binary: "/tmp/lfg" });
    expect(spawned).toEqual([["/tmp/lfg", "mcp"]]);
  });

  test("does not spawn when there is no install", async () => {
    const result = await forwardToInstall(["serve"], {
      which: () => null,
      exists: () => false,
      homedir: () => "/tmp/empty",
    });
    expect(result.forwarded).toBe(false);
    expect(result.binary).toBeNull();
  });
});
