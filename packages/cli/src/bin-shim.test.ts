import { describe, expect, test } from "bun:test";
import { MISSING_BUN_MESSAGE, resolveBun, run } from "./bin-shim.mjs";

describe("resolveBun", () => {
  test("prefers the Bun already running this file", () => {
    expect(
      resolveBun({
        self: "/already/running/bun",
        exists: (path) => path === "/already/running/bun",
        env: { PATH: "/usr/bin" },
      }),
    ).toBe("/already/running/bun");
  });

  test("honours OMG_BUN_PATH when the current process is not Bun", () => {
    expect(
      resolveBun({
        self: null,
        exists: (path) => path === "/custom/bun",
        env: { OMG_BUN_PATH: "/custom/bun", PATH: "" },
      }),
    ).toBe("/custom/bun");
  });

  test("looks in ~/.bun/bin when PATH is empty", () => {
    expect(
      resolveBun({
        self: null,
        exists: (path) => path === "/home/x/.bun/bin/bun",
        env: { HOME: "/home/x", PATH: "" },
      }),
    ).toBe("/home/x/.bun/bin/bun");
  });
});

describe("run", () => {
  test("prints an actionable message when Bun is missing", () => {
    let written = "";
    const code = run(["help"], {
      exists: () => false,
      env: { PATH: "" },
      stderr: { write: (chunk: string) => (written += chunk) },
    });
    expect(code).toBe(1);
    expect(written).toContain(MISSING_BUN_MESSAGE);
  });

  test("puts the located Bun on PATH for the forwarded install", () => {
    let childPath = "";
    run(["serve"], {
      exists: (path) => path === "/opt/bun/bin/bun",
      env: { PATH: "/usr/bin", OMG_BUN_PATH: "/opt/bun/bin/bun" },
      entryDir: "/tmp/cli-dist",
      spawn: (_cmd: string, _args: string[], options: { env?: { PATH?: string } }) => {
        childPath = options.env?.PATH ?? "";
        return { status: 0 };
      },
    });
    expect(childPath.startsWith("/opt/bun/bin:")).toBe(true);
  });
});
