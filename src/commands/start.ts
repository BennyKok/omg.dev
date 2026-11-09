/**
 * `omg computer start` — start the installed background service.
 *
 * `omg update --restart` asks the RUNNING service to restart itself, so it can
 * do nothing for a service that is stopped. Starting by hand meant knowing the
 * unit name, and that name differs per box (`omg` on new installs, `lfg` on
 * older ones — see src/service-unit.ts). Typing the wrong one gives "Unit not
 * found", which reads as "omg.dev is not installed".
 *
 * This resolves the installed unit, starts it, and waits until the local port
 * answers. It never installs a unit; that is `omg setup`.
 */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import {
  installedLaunchAgent,
  installedSystemdUnit,
  launchAgentPath,
} from "../service-unit.ts";
import { localServeControl, type ServeIdentity } from "./update.ts";

type RunResult = { status: number | null; stderr?: string | Buffer | null; error?: Error };

export type StartDependencies = {
  platform: NodeJS.Platform;
  home: string;
  uid: number;
  run: (command: string[]) => RunResult;
  probe: () => Promise<ServeIdentity | null>;
  output: (message: string) => void;
  sleep: (ms: number) => Promise<void>;
  startTimeoutMs: number;
  pollIntervalMs: number;
};

const NO_SERVICE =
  "No background service is installed on this computer. Run omg computer setup to install it, or run omg serve to run omg.dev in this terminal.";

/** The commands that start the installed service, in order. Null when none is installed. */
export function startCommands(
  platform: NodeJS.Platform,
  home: string,
  uid: number,
): { name: string; commands: string[][]; tolerateFirstFailure: boolean } | null {
  if (platform === "darwin") {
    const label = installedLaunchAgent(home);
    if (!label) return null;
    // bootstrap loads the agent and fails when it is already loaded; kickstart
    // (without -k) then starts it if it is loaded but not running.
    return {
      name: label,
      commands: [
        ["launchctl", "bootstrap", `gui/${uid}`, launchAgentPath(label, home)],
        ["launchctl", "kickstart", `gui/${uid}/${label}`],
      ],
      tolerateFirstFailure: true,
    };
  }
  const unit = installedSystemdUnit(home);
  if (!unit) return null;
  return {
    name: `${unit}.service`,
    commands: [["systemctl", "--user", "start", `${unit}.service`]],
    tolerateFirstFailure: false,
  };
}

function stderrText(result: RunResult): string {
  return result.stderr ? result.stderr.toString().trim() : "";
}

export async function startService(deps: StartDependencies): Promise<void> {
  const running = await deps.probe();
  if (running) {
    deps.output(`omg.dev is already running${running.version ? ` (${running.version})` : ""}.`);
    return;
  }
  const plan = startCommands(deps.platform, deps.home, deps.uid);
  if (!plan) throw new Error(NO_SERVICE);

  deps.output(`Starting ${plan.name}…`);
  plan.commands.forEach((command, index) => {
    const result = deps.run(command);
    if (result.error) throw new Error(`${command.join(" ")} failed: ${result.error.message}`);
    if (result.status !== 0 && !(plan.tolerateFirstFailure && index === 0)) {
      throw new Error(`${command.join(" ")} failed: ${stderrText(result) || `exit ${result.status}`}`);
    }
  });

  const deadline = Date.now() + deps.startTimeoutMs;
  while (Date.now() < deadline) {
    await deps.sleep(deps.pollIntervalMs);
    const after = await deps.probe();
    if (after) {
      deps.output(`omg.dev is running${after.version ? ` (${after.version})` : ""}.`);
      return;
    }
  }
  const logs = deps.platform === "darwin"
    ? "the service log in ~/Library/Logs"
    : `journalctl --user -u ${plan.name} -n 50`;
  throw new Error(`${plan.name} did not answer within ${Math.round(deps.startTimeoutMs / 1000)}s. Check ${logs}.`);
}

export async function cmdStart(args: string[], overrides: Partial<StartDependencies> = {}): Promise<void> {
  const output = overrides.output ?? ((message: string) => process.stdout.write(`${message}\n`));
  if (args.includes("--help") || args.includes("-h")) {
    output("omg computer start\n\nStart the installed background service and wait until it answers.");
    return;
  }
  if (args.length > 0) throw new Error(`Unknown option: ${args[0]}. Usage: omg computer start`);
  await startService({
    platform: process.platform,
    home: homedir(),
    uid: process.getuid?.() ?? 0,
    run: command => spawnSync(command[0]!, command.slice(1), { stdio: "pipe", timeout: 30_000 }),
    probe: () => localServeControl().probe(),
    output,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    startTimeoutMs: 60_000,
    pollIntervalMs: 1_000,
    ...overrides,
  });
}
