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
 * The restart is done by the RUNNING service, not by this command. This
 * command is a separate process. On an omg.dev Computer, the only restart
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
export type ServeIdentity = { bootId: string; version?: string };

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

export function localServeControl(base = localServeBaseUrl()): ServeControl {
  return {
    async probe() {
      try {
        const res = await fetch(`${base}/api/install?ready=1`, {
          cache: "no-store",
          signal: AbortSignal.timeout(3_000),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { bootId?: unknown; version?: unknown };
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
        return { bootId: body.bootId, ...(version ? { version } : {}) };
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
        if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
        if (!body.restarting) throw new Error("The service did not start a restart.");
        return;
      }
      // A source checkout is a development box under systemd or launchd. Those
      // restart the unit by name, so running the command from here is correct.
      // The omg.dev supervisor path signals a pid, and from this process it
      // would name the wrong one, so it is refused.
      const { command, reason } = restartCapability();
      if (!command || command.some(part => part.endsWith("/kill"))) {
        throw new Error(reason || "This install cannot be restarted from the command line.");
      }
      const result = spawnSync(command[0]!, command.slice(1), { stdio: "ignore" });
      if (result.status !== 0) throw new Error(`${command.join(" ")} exited with ${result.status}.`);
    },
  };
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
  if (!before) {
    deps.output(`The service is not running. It starts omg.dev ${target} when it next starts.`);
    return;
  }
  if (before.version === target) {
    deps.output(`The service already runs omg.dev ${target}.`);
    return;
  }

  deps.output(`Restarting the service (running ${before.version ?? "an older version"}, installed ${target})…`);
  await deps.serve.requestRestart(channel);

  const deadline = Date.now() + deps.restartTimeoutMs;
  let after: ServeIdentity | null = null;
  while (Date.now() < deadline) {
    await deps.sleep(deps.pollIntervalMs);
    after = await deps.serve.probe();
    if (after && after.bootId !== before.bootId) break;
  }
  const seconds = Math.round(deps.restartTimeoutMs / 1000);
  if (!after || after.bootId === before.bootId) {
    throw new Error(
      after
        ? `The service did not restart within ${seconds}s. It still runs the old code (${before.version ?? "unknown version"}). Installed: ${target}.`
        : `The service did not come back within ${seconds}s after the restart. Installed: ${target}.`,
    );
  }
  if (after.version !== target) {
    throw new Error(
      `The service restarted but runs ${after.version ?? "an unknown version"}, not the installed ${target}.`,
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
    deps.output("Usage: omg update [--check]");
    deps.output("");
    deps.output("Updates this installation to the latest release and restarts the service.");
    deps.output("  --check   report what an update would do, and change nothing");
    return;
  }
  const unknown = args.find(arg => !["--check"].includes(arg));
  if (unknown) throw new Error(`Unknown update option: ${unknown}`);
  const checkOnly = args.includes("--check");

  const { channel } = deps.install;
  if (channel !== "source" && channel !== "release") {
    // A container image is rebuilt and redeployed, not updated in place; saying
    // so is more useful than failing halfway through swapping files.
    throw new Error(
      `This is a ${channel} install. Update it through the deployment that owns it.`,
    );
  }

  if (checkOnly) {
    const status = channel === "source"
      ? await sourceUpdateStatus(deps.root)
      : await releaseUpdateStatus(deps.root, deps.install as ReleaseInstall, true);
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
    : await applyReleaseUpdate(deps.root, deps.install as ReleaseInstall);

  if (result.status.state === "blocked") {
    throw new Error(result.status.message);
  }
  if (result.updated) {
    deps.output(`Updated to omg.dev ${deps.diskVersion()}.`);
  } else {
    deps.output(result.status.message || "Already up to date.");
  }
  await restartRunningService(deps, channel);
}
