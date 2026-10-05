import { describe, expect, test } from "bun:test";
import { APP_COMMANDS } from "./apps.ts";
import { HELP_BANNER } from "./help.ts";
import { runCli } from "./index.ts";
import manifest from "../package.json" with { type: "json" };

const noInstall = { which: () => null, exists: () => false };

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
  test("this package is 0.5.1 or newer so npm latest is not 0.4.42 or 0.5.0", () => {
    const [major, minor, patch] = String(manifest.version).split(".").map(Number);
    expect(major * 10000 + minor * 100 + patch).toBeGreaterThanOrEqual(501);
  });
});

describe("omg help names the control plane and the hosted app verbs", () => {
  test("help before setup prints the probe phrase setup.sh greps for", async () => {
    const log = capture();
    expect(await runCli(["help"], { ...log, ...noInstall })).toBe(0);
    expect(log.text()).toContain(HELP_BANNER);
    expect(log.text()).toContain("computer setup");
    expect(log.text()).toContain("localhost:8766");
    expect(log.text()).toContain("omg create");
    expect(log.text()).toContain("omg deploy");
    expect(log.text()).toContain("omg login");
    expect(log.text()).not.toContain("omg-apps");
  });

  // setup.sh runs the probe to decide whether this `omg` is the wrapper. If
  // the probe forwarded, an installed computer would answer with the
  // install's help instead and the decision would depend on install state.
  test("the forward probe never forwards, so setup.sh can surrender omg", async () => {
    const log = capture();
    const spawned: string[][] = [];
    const code = await runCli(["__omg_forward_probe"], {
      ...log,
      which: () => "/tmp/lfg",
      spawn: async (argv) => {
        spawned.push(argv);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(spawned).toEqual([]);
    expect(log.text()).toContain("run and manage your AI coding agents");
  });

  // The install owns the complete command list. Without this, `omg help`
  // showed a short list and hid most commands that `omg` actually runs.
  test("help on an installed computer shows the install's full list", async () => {
    for (const argv of [[], ["help"], ["--help"], ["computer", "help"]]) {
      const log = capture();
      const spawned: string[][] = [];
      const code = await runCli(argv, {
        ...log,
        which: () => "/tmp/lfg",
        spawn: async (command) => {
          spawned.push(command);
          return 0;
        },
      });
      expect(code, argv.join(" ")).toBe(0);
      expect(spawned, argv.join(" ")).toEqual([["/tmp/lfg", "help"]]);
    }
  });

  test("hosted app verbs start the old app flow on this same omg", async () => {
    for (const command of APP_COMMANDS) {
      const log = capture();
      const spawned: string[][] = [];
      const code = await runCli([command, "arg"], {
        ...log,
        which: () => "/tmp/lfg",
        spawn: async (argv) => {
          spawned.push(argv);
          return 0;
        },
      });
      expect(code, command).toBe(0);
      expect(spawned, command).toEqual([["/tmp/lfg", command, "arg"]]);
      expect(log.text(), command).not.toContain("not part of the current omg.dev product");
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

  test("computer setup does not start a hosted app command", async () => {
    const spawned: string[][] = [];
    const log = capture();
    await runCli(["computer", "setup"], {
      ...log,
      which: () => "/tmp/lfg",
      spawn: async (argv) => {
        spawned.push(argv);
        return 0;
      },
    });
    expect(spawned).toEqual([]);
    expect(log.text()).toContain("already set up");
    expect(log.text()).toContain("localhost:8766");
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
