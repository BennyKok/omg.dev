import { describe, expect, test } from "bun:test";
import { HELP_BANNER, RETIRED_APP_COMMANDS } from "./help.ts";
import { runCli } from "./index.ts";
import manifest from "../package.json" with { type: "json" };

function capture() {
  const lines: string[] = [];
  return {
    lines,
    output: (line: string) => {
      lines.push(line);
    },
    error: (line: string) => {
      lines.push(line);
    },
    text: () => lines.join("\n"),
  };
}

describe("published version can replace the retired 0.4.x line", () => {
  test("this package is 0.5.0 or newer so npm latest is not 0.4.42", () => {
    const [major, minor] = String(manifest.version).split(".").map(Number);
    expect(major * 100 + minor).toBeGreaterThanOrEqual(5);
  });
});

describe("omg help is the control plane, not the retired app CLI", () => {
  test("help prints the probe phrase setup.sh greps for", async () => {
    const log = capture();
    expect(await runCli(["help"], log)).toBe(0);
    expect(log.text()).toContain(HELP_BANNER);
    expect(log.text()).toContain("computer setup");
    expect(log.text()).toContain("localhost:8766");
    expect(log.text()).not.toContain("omg create");
    expect(log.text()).not.toContain("omg deploy");
  });

  test("the forward probe is the same help, so setup.sh can surrender omg", async () => {
    const log = capture();
    expect(await runCli(["__omg_forward_probe"], log)).toBe(0);
    expect(log.text()).toContain("run and manage your AI coding agents");
  });

  test("retired prompt-to-app verbs are rejected, not forwarded", async () => {
    for (const command of RETIRED_APP_COMMANDS) {
      const log = capture();
      const spawned: string[][] = [];
      const code = await runCli([command], {
        ...log,
        which: () => "/tmp/lfg",
        spawn: async (argv) => {
          spawned.push(argv);
          return 0;
        },
      });
      expect(code, command).toBe(1);
      expect(log.text(), command).toContain("not part of the current omg.dev product");
      expect(spawned, command).toEqual([]);
    }
  });
});

describe("omg computer", () => {
  test("setup downloads setup.sh and runs it when nothing is installed", async () => {
    const log = capture();
    const ran: string[][] = [];
    let installed = false;
    const code = await runCli(["computer", "setup"], {
      ...log,
      which: () => (installed ? "/tmp/home/.local/bin/lfg" : null),
      exists: () => installed,
      homedir: () => "/tmp/home",
      fetchText: async () => "#!/bin/sh\necho setup\n",
      runCommand: async (argv) => {
        ran.push(argv);
        installed = true;
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(ran[0]?.[0]).toBe("bash");
    expect(log.text()).toContain("localhost:8766");
  });

  test("setup is a no-op when lfg is already installed", async () => {
    const log = capture();
    let fetched = false;
    const code = await runCli(["computer", "setup"], {
      ...log,
      which: () => "/tmp/lfg",
      fetchText: async () => {
        fetched = true;
        return "";
      },
    });
    expect(code).toBe(0);
    expect(fetched).toBe(false);
    expect(log.text()).toContain("already set up");
  });

  test("update and uninstall go to the install, not to setup.sh", async () => {
    const ran: string[][] = [];
    const log = capture();
    await runCli(["computer", "update"], {
      ...log,
      which: () => "/tmp/lfg",
      runCommand: async (argv) => {
        ran.push(argv);
        return 0;
      },
    });
    await runCli(["computer", "uninstall", "--purge", "--yes"], {
      ...log,
      which: () => "/tmp/lfg",
      runCommand: async (argv) => {
        ran.push(argv);
        return 0;
      },
    });
    expect(ran).toEqual([
      ["/tmp/lfg", "setup"],
      ["/tmp/lfg", "uninstall", "--purge", "--yes"],
    ]);
  });

  test("serve forwards to the install", async () => {
    const spawned: string[][] = [];
    const code = await runCli(["serve"], {
      which: () => "/tmp/lfg",
      spawn: async (argv) => {
        spawned.push(argv);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(spawned).toEqual([["/tmp/lfg", "serve"]]);
  });

  test("serve without an install tells the user to run computer setup", async () => {
    const log = capture();
    const code = await runCli(["serve"], {
      ...log,
      which: () => null,
      exists: () => false,
      homedir: () => "/tmp/empty-home",
    });
    expect(code).toBe(1);
    expect(log.text()).toContain("omg computer setup");
  });
});
