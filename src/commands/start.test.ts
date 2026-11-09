// `omg computer start` exists because a stopped service had no command-line
// answer: `update --restart` asks the running service to restart itself, and
// starting the unit by hand meant knowing whether this box calls it `omg` or
// `lfg`. These tests pin the name resolution and the wait for the port.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdStart, startService, type StartDependencies } from "./start.ts";
import type { ServeIdentity } from "./update.ts";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function homeWith(file?: string): string {
  const home = mkdtempSync(join(tmpdir(), "omg-start-"));
  homes.push(home);
  if (file) {
    mkdirSync(join(home, file, ".."), { recursive: true });
    writeFileSync(join(home, file), "");
  }
  return home;
}

function harness(home: string, opts: { platform?: NodeJS.Platform; probes?: (ServeIdentity | null)[]; status?: number[] } = {}) {
  const ran: string[][] = [];
  const output: string[] = [];
  const probes = [...(opts.probes ?? [])];
  const statuses = [...(opts.status ?? [])];
  const deps: StartDependencies = {
    platform: opts.platform ?? "linux",
    home,
    uid: 501,
    run: command => {
      ran.push(command);
      return { status: statuses.shift() ?? 0, stderr: "boom" };
    },
    probe: async () => (probes.length ? probes.shift()! : null),
    output: message => output.push(message),
    sleep: async () => {},
    startTimeoutMs: 50,
    pollIntervalMs: 1,
  };
  return { deps, ran, output };
}

const UP: ServeIdentity = { bootId: "b1", version: "0.9.0" };

describe("startService", () => {
  test("starts the omg unit on a new install and waits until it answers", async () => {
    const h = harness(homeWith(".config/systemd/user/omg.service"), { probes: [null, null, UP] });
    await startService(h.deps);
    expect(h.ran).toEqual([["systemctl", "--user", "start", "omg.service"]]);
    expect(h.output.at(-1)).toBe("omg.dev is running (0.9.0).");
  });

  test("starts the legacy lfg unit on an older install", async () => {
    const h = harness(homeWith(".config/systemd/user/lfg.service"), { probes: [null, UP] });
    await startService(h.deps);
    expect(h.ran).toEqual([["systemctl", "--user", "start", "lfg.service"]]);
  });

  test("does nothing when the service already answers", async () => {
    const h = harness(homeWith(".config/systemd/user/omg.service"), { probes: [UP] });
    await startService(h.deps);
    expect(h.ran).toEqual([]);
    expect(h.output).toEqual(["omg.dev is already running (0.9.0)."]);
  });

  test("names setup when no service is installed", async () => {
    const h = harness(homeWith());
    await expect(startService(h.deps)).rejects.toThrow("omg computer setup");
    expect(h.ran).toEqual([]);
  });

  test("reports the systemctl error", async () => {
    const h = harness(homeWith(".config/systemd/user/omg.service"), { status: [1] });
    await expect(startService(h.deps)).rejects.toThrow("systemctl --user start omg.service failed: boom");
  });

  test("fails with the log command when the port never answers", async () => {
    const h = harness(homeWith(".config/systemd/user/omg.service"));
    await expect(startService(h.deps)).rejects.toThrow("journalctl --user -u omg.service");
  });

  test("on macOS, loads then starts the launch agent and tolerates an already-loaded agent", async () => {
    const home = homeWith("Library/LaunchAgents/dev.omg.serve.plist");
    const h = harness(home, { platform: "darwin", probes: [null, UP], status: [5, 0] });
    await startService(h.deps);
    expect(h.ran).toEqual([
      ["launchctl", "bootstrap", "gui/501", join(home, "Library/LaunchAgents/dev.omg.serve.plist")],
      ["launchctl", "kickstart", "gui/501/dev.omg.serve"],
    ]);
  });
});

describe("cmdStart", () => {
  test("help is read-only", async () => {
    const output: string[] = [];
    await cmdStart(["--help"], { output: message => output.push(message), run: () => { throw new Error("ran"); } });
    expect(output[0]).toContain("omg computer start");
  });

  test("rejects unknown options", async () => {
    await expect(cmdStart(["--now"], { output: () => {} })).rejects.toThrow("Unknown option: --now");
  });
});
