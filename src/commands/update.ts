/**
 * `omg update` — bring this install up to the latest release.
 *
 * The capability already existed twice: the web UI has an update button, and
 * `omg setup` re-provisions and picks up a new release on the way past. Neither
 * is the thing someone reaches for from a terminal. `setup` in particular reads
 * like it might reconfigure the machine, so "how do I just update?" had no
 * obvious answer.
 *
 * This runs the same path the UI button does, so there is one update mechanism
 * rather than a second one that drifts: a git pull for source installs, a
 * release bundle swap otherwise, then a service restart.
 *
 * Release restarts normally go through the RUNNING service. This command
 * can also restart a native user service when an old server rejects that API.
 * On an omg.dev Computer, the only restart
 * mechanism is "the serve process exits and the supervisor loop starts it
 * again", and a restart command computed here would signal this CLI's own pid.
 * For a long time this command printed "Restarting the service…" and did
 * nothing, so a Computer kept serving the old code after every update.
 *
 * After it asks for the restart, the command waits for a new boot id and
 * checks that the new process runs the version on disk. It fails loudly if the
 * old version is still serving.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { restartHint } from "../service-unit.ts";
import { installInfo, localServeBaseUrl, PATHS, stagedVersion } from "../config.ts";
import {
  applyReleaseUpdate,
  applySourceUpdate,
  releaseUpdateStatus,
  restartCapability,
  sourceUpdateStatus,
  type ReleaseInstall,
} from "../self-update.ts";

/** What the running service says about itself. `version` is absent before 0.6.138. */
export type ServeIdentity = { bootId: string; version?: string; desktopRuntimeId?: string; root?: string };

export type ServeControl = {
  /** The running service, or null when nothing answers on the local port. */
  probe(): Promise<ServeIdentity | null>;
  /** Ask the running service to restart itself. Throws with the reason when it refuses. */
  requestRestart(channel: "source" | "release"): Promise<void>;
};

export type UpdateDependencies = {
  root: string;
  install: ReturnType<typeof installInfo>;
  output: (message: string) => void;
  serve: ServeControl;
  /** The version on disk, which is what a restarted service will run. */
  diskVersion: () => string;
  sleep: (ms: number) => Promise<void>;
  restartTimeoutMs: number;
  pollIntervalMs: number;
};

export function restartLocalService(
  capability = restartCapability(),
  run = (command: string[]) => spawnSync(command[0]!, command.slice(1), { stdio: "pipe", timeout: 30_000 }),
): void {
  const { command, reason } = capability;
  // A supervisor-loop command computed here would kill the CLI itself.
  if (!command || command.some(part => part.endsWith("/kill"))) {
    throw new Error(reason || "This install cannot be restarted from the command line.");
  }
  const result = run(command);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} failed: ${result.stderr?.toString().trim() || `exit ${result.status}`}`);
  }
}

export function localServeControl(
  base = localServeBaseUrl(),
  restartLocal: () => void = restartLocalService,
): ServeControl {
  return {
    async probe() {
      try {
        const res = await fetch(`${base}/api/install?ready=1`, {
          cache: "no-store",
          signal: AbortSignal.timeout(3_000),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { bootId?: unknown; version?: unknown; desktopRuntimeId?: unknown; root?: unknown };
        if (typeof body.bootId !== "string" || !body.bootId) return null;
        let version = typeof body.version === "string" ? body.version : undefined;
        if (!version) {
          // Services before 0.6.138 report their running version only in the
          // heavier bootstrap payload.
          const boot = await fetch(`${base}/api/bootstrap`, {
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
          }).then(r => (r.ok ? r.json() : null)).catch(() => null) as { version?: unknown } | null;
          if (typeof boot?.version === "string") version = boot.version;
        }
        return {
          bootId: body.bootId,
          ...(version ? { version } : {}),
          ...(typeof body.desktopRuntimeId === "string" && body.desktopRuntimeId ? { desktopRuntimeId: body.desktopRuntimeId } : {}),
          ...(typeof body.root === "string" && body.root ? { root: body.root } : {}),
        };
      } catch {
        return null;
      }
    },
    async requestRestart(channel) {
      if (channel === "release") {
        // The same request the Restart button in the update drawer sends. The
        // service sees the files on disk are newer than what it runs ("staged")
        // and restarts itself through its own supervisor: systemd, launchd, or
        // the omg.dev loop. Services older than this command support it too.
        const res = await fetch(`${base}/api/install`, {
          method: "POST",
          signal: AbortSignal.timeout(120_000),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; restarting?: boolean };
        // Older services can reject this API because their install metadata is
        // unknown. Only that specific rejection permits a native restart;
        // authorization failures and concurrent updates must remain failures.
        if (res.status === 400 && body.error === "UI updates are only available for Git and release installs.") {
          restartLocal();
          return;
        }
        if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
        if (!body.restarting) throw new Error("The service did not start a restart.");
        return;
      }
      // A source checkout is a development box under systemd or launchd. Those
      // restart the unit by name, so running the command from here is correct.
      // The omg.dev supervisor path signals a pid, and from this process it
      // would name the wrong one, so it is refused.
      restartLocal();
    },
  };
}

function canonicalPath(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

function assertMatchingService(root: string, service: ServeIdentity | null): void {
  if (service?.desktopRuntimeId) {
    throw new Error(
      `The local address is served by the omg.dev desktop app (running ${service.version ?? "an unknown version"}). `
      + `This command updates the separate install at ${root}. Quit the desktop app fully, run ${restartHint()}, `
      + "then run omg update again. Open the local URL in your browser. To keep using the desktop app, update that app separately.",
    );
  }
  if (service?.root && canonicalPath(service.root) !== canonicalPath(root)) {
    throw new Error(`The service runs from ${service.root}, but this command targets ${root}. Use the CLI from the running install, or correct the background service configuration.`);
  }
}

function defaultDependencies(): UpdateDependencies {
  return {
    root: PATHS.root,
    install: installInfo(),
    output: message => process.stdout.write(`${message}\n`),
    serve: localServeControl(),
    diskVersion: stagedVersion,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    restartTimeoutMs: 120_000,
    pollIntervalMs: 1_000,
  };
}

/**
 * Make the running service run the version on disk, and prove it.
 *
 * Runs even when this invocation downloaded nothing. A box can hold an update
 * on disk that the service never loaded; that is exactly the state every
 * Computer was left in by the old command.
 */
export async function restartRunningService(
  deps: UpdateDependencies,
  channel: "source" | "release",
): Promise<void> {
  const target = deps.diskVersion();
  const before = await deps.serve.probe();
  assertMatchingService(deps.root, before);
  if (!before) {
    deps.output(`The service is not running. It starts omg.dev ${target} when it next starts.`);
    return;
  }
  if (before.version === target) {
    deps.output(`The service already runs omg.dev ${target}.`);
    return;
  }

  deps.output(`Restarting the service (running ${before.version ?? "an older version"}, installed ${target})…`);
  try {
    await deps.serve.requestRestart(channel);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nInstalled: ${target} at ${deps.root}. Run omg update --restart to retry without downloading.`);
  }

  const deadline = Date.now() + deps.restartTimeoutMs;
  let after: ServeIdentity | null = null;
  while (Date.now() < deadline) {
    await deps.sleep(deps.pollIntervalMs);
    after = await deps.serve.probe();
    assertMatchingService(deps.root, after);
    if (after && after.bootId !== before.bootId) break;
  }
  const seconds = Math.round(deps.restartTimeoutMs / 1000);
  if (!after || after.bootId === before.bootId) {
    throw new Error(
      after
        ? `The service did not restart within ${seconds}s. It still runs the old code (${before.version ?? "unknown version"}). Installed: ${target} at ${deps.root}. Check which process owns the local address and which install the background service starts. Run omg update --restart after correcting it; no download is needed.`
        : `The service did not come back within ${seconds}s after the restart. Installed: ${target}.`,
    );
  }
  if (after.version !== target) {
    throw new Error(
      `The service restarted but runs ${after.version ?? "an unknown version"}, not the installed ${target} at ${deps.root}. Check the background service configuration for another install. Run omg update --restart after correcting it; no download is needed.`,
    );
  }
  deps.output(`The service now runs omg.dev ${after.version}.`);
}

export async function cmdUpdate(
  args: string[],
  overrides: Partial<UpdateDependencies> = {},
): Promise<void> {
  const deps = { ...defaultDependencies(), ...overrides };

  if (args.includes("--help") || args.includes("-h")) {
    deps.output("Usage: omg update [--check | --restart]");
    deps.output("");
    deps.output("Updates this installation to the latest release and restarts the service.");
    deps.output("  --check   report what an update would do, and change nothing");
    deps.output("  --restart restart and verify the installed version without downloading");
    return;
  }
  const unknown = args.find(arg => !["--check", "--restart"].includes(arg));
  if (unknown) throw new Error(`Unknown update option: ${unknown}`);
  const checkOnly = args.includes("--check");
  const restartOnly = args.includes("--restart");
  if (checkOnly && restartOnly) throw new Error("Use either --check or --restart, not both.");

  const { channel } = deps.install;
  if (channel !== "source" && channel !== "release") {
    // A container image is rebuilt and redeployed, not updated in place; saying
    // so is more useful than failing halfway through swapping files.
    throw new Error(
      `This is a ${channel} install. Update it through the deployment that owns it.`,
    );
  }

  const service = await deps.serve.probe();
  deps.output(`Installed: omg.dev ${deps.diskVersion()} at ${deps.root}.`);
  deps.output(service ? `Running: omg.dev ${service.version ?? "unknown"}.` : "No running omg.dev service was detected.");
  assertMatchingService(deps.root, service);

  if (restartOnly) {
    await restartRunningService(deps, channel);
    return;
  }

  if (checkOnly) {
    const status = channel === "source"
      ? await sourceUpdateStatus(deps.root)
      : await releaseUpdateStatus(deps.root, deps.install as ReleaseInstall, true, service?.version ?? deps.diskVersion());
    if (status.state === "blocked") {
      deps.output(`Cannot update: ${status.message}`);
      return;
    }
    if (status.state === "available") {
      deps.output(`Update available: ${status.message}`);
      return;
    }
    deps.output(status.message || "Already up to date.");
    return;
  }

  deps.output("Checking for an update…");
  const result = channel === "source"
    ? await applySourceUpdate(deps.root)
    : await applyReleaseUpdate(deps.root, deps.install as ReleaseInstall, deps.output);

  if (result.status.state === "blocked") {
    throw new Error(result.status.message);
  }
  if (result.updated) {
    deps.output(`Installed omg.dev ${deps.diskVersion()}. Verifying the running service…`);
  } else if (channel === "release") {
    deps.output(`omg.dev ${deps.diskVersion()} is already installed. Verifying the running service…`);
  } else {
    deps.output(result.status.message || "Already up to date.");
  }
  await restartRunningService(deps, channel);
}
