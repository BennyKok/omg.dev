import { describe, expect, test } from "bun:test";
import { APP_COMMANDS, runAppCommand } from "./apps.ts";

describe("hosted app verbs stay on this omg binary", () => {
  test("create, deploy, and login are in the forwarded set", () => {
    expect(APP_COMMANDS.has("create")).toBe(true);
    expect(APP_COMMANDS.has("deploy")).toBe(true);
    expect(APP_COMMANDS.has("login")).toBe(true);
    expect(APP_COMMANDS.has("whoami")).toBe(true);
    expect(APP_COMMANDS.has("computer")).toBe(false);
    expect(APP_COMMANDS.has("serve")).toBe(false);
  });
});

describe("runAppCommand", () => {
  test("forwards outer verbs to the installed runtime", async () => {
    const spawned: string[][] = [];
    const code = await runAppCommand(["deploy"], {
      which: () => "/tmp/lfg",
      spawn: async (argv) => {
        spawned.push(argv);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(spawned).toEqual([["/tmp/lfg", "deploy"]]);
  });

  test("tells the user to set up when there is no install", async () => {
    const lines: string[] = [];
    const code = await runAppCommand(["login"], {
      which: () => null,
      exists: () => false,
      homedir: () => "/tmp/missing-apps",
      error: (line) => {
        lines.push(line);
      },
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("omg computer setup");
  });
});
