import { existsSync } from "node:fs";
import {
  currentBootId,
  findEntryByAnyId,
  isPidAlive,
  listEntries,
  patchEntry,
  type AisdkEntry,
} from "./aisdk-registry.ts";
import {
  addManaged,
  listManaged,
  managedContainment,
  patchManaged,
  removeManaged,
  type ManagedContainment,
  type ManagedSession,
} from "./managed.ts";
import { computerAgentAdmissionContext, isScheduleSpawned } from "./agent-admission.ts";
import {
  spawnManagedAisdkSession,
  spawnManagedCodexAisdkSession,
  spawnManagedCopilotSdkSession,
  spawnManagedCursorAcpSession,
  spawnManagedFxAcpSession,
  spawnManagedGrokAcpSession,
  spawnManagedJcodeSession,
  spawnManagedJcodeSdkSession,
  spawnManagedMuseMspSession,
  spawnManagedOpencodeAisdkSession,
  spawnManagedPiSession,
  tmuxHasSession,
  type ManagedHarnessSpawnResult,
} from "./tmux.ts";
import { userAssignments } from "./users.ts";
import { CODING_AGENT_ADAPTERS } from "./coding-agent-adapters.ts";

export { managedContainment };

export type RecoveryResult = {
  bootId: string | null;
  adopted: number;
  recovered: number;
  failed: number;
  skippedLegacy: number;
  skippedSchedule: number;
  /** Native tmux agents (jcode) relaunched against their own transcript. */
  recoveredTmux: number;
};

// jcode runs in a tmux pane and keeps its own append-only journal, so a pane
// killed by a reboot can be reopened from `nativeSessionId`. Without this the
// row stays launchState:"running" forever, pointing at a tmux session that no
// longer exists, and the work is only recoverable by hand.
function recoverJcodeSessions(bootId: string, log: (line: string) => void): number {
  let recovered = 0;
  const assignments = userAssignments();
  for (const row of listManaged()) {
    if (row.agent !== "jcode" || row.runtime === "command-file") continue;
    if (row.launchState !== "running" && row.launchState !== "launching") continue;
    if (!row.nativeSessionId || !row.cwd) continue;
    // One attempt per boot: a pane that dies immediately must not respawn on
    // every serve restart.
    if (row.recoveryClaimBootId === bootId) continue;
    if (tmuxHasSession(row.tmuxName)) continue;
    // The worktree sweeper reclaims directories of finished sessions. Resuming
    // into a missing cwd cannot work, so leave the row for manual triage.
    if (!existsSync(row.cwd)) continue;
    patchManaged(row.tmuxName, { recoveryClaimBootId: bootId });
    const recoveredAt = Date.now();
    const spawned = spawnManagedJcodeSession({
      name: row.tmuxName,
      cwd: row.cwd,
      model: row.model,
      thinkingLevel: row.thinkingLevel,
      resume: row.nativeSessionId,
      omgSessionId: row.sessionId,
      omgUser: assignments[row.tmuxName] ?? null,
    });
    if (!spawned.ok) {
      patchManaged(row.tmuxName, {
        launchState: "failed",
        launchError: spawned.error || "jcode recovery launch failed",
        interruptedAt: recoveredAt,
      });
      log(`[session-recovery] jcode failed ${row.tmuxName}: ${spawned.error || "launch failed"}`);
      continue;
    }
    patchManaged(row.tmuxName, {
      launchState: "running",
      launchError: undefined,
      interruptedAt: recoveredAt,
    });
    log(`[session-recovery] reopened jcode ${row.tmuxName} (${row.nativeSessionId})`);
    recovered++;
  }
  return recovered;
}

function matchingManaged(entry: AisdkEntry, managed: ManagedSession[]): ManagedSession | null {
  return managed.find((row) => row.tmuxName === entry.tmuxName) ??
    managed.find((row) =>
      row.sessionId === entry.sessionId ||
      row.nativeSessionId === entry.sessionId ||
      (!!entry.threadId && (row.sessionId === entry.threadId || row.nativeSessionId === entry.threadId))
    ) ?? null;
}

// The egress proxy lives in serve and its port can change on every restart, so
// the URL is rebuilt at launch time instead of being read from the row.
let egressProxyUrlFor: ((sessionId: string) => string | null) | null = null;
export function setRecoveryEgressProxy(resolve: ((sessionId: string) => string | null) | null): void {
  egressProxyUrlFor = resolve;
}

export function launchRecovered(
  entry: AisdkEntry,
  managed: ManagedSession,
  recoveredAt: number,
  assignedUser: string | null,
): ManagedHarnessSpawnResult {
  const containment = managedContainment(managed);
  const omgSessionId = managed.sessionId || entry.sessionId;
  const common = {
    name: managed.tmuxName,
    cwd: managed.cwd || entry.cwd,
    model: managed.model || entry.model,
    omgSessionId,
    omgUser: assignedUser,
    recoveredAt,
    containInAgentSlice: containment.agentSlice,
  };
  // Sandbox and egress reach only the harnesses whose first launch forwards
  // them (ACTIVE_CODING_AGENT_PROVIDERS: aisdk, codex-aisdk, opencode/omg, pi).
  // The others ran without them, and a relaunch matches the first launch.
  let policy: { sandbox: ManagedContainment["sandbox"]; egressProxyUrl?: string } = { sandbox: "none" };
  const forwardsPolicy = !["grok", "cursor", "fx", "muse", "copilot", "jcode", "deepseek", "devin"].includes(entry.agent ?? "");
  if (forwardsPolicy) {
    policy = { sandbox: containment.sandbox };
    if (containment.egressProxy) {
      // Fail closed: a restricted session must not come back with open egress.
      const url = egressProxyUrlFor?.(omgSessionId) ?? null;
      if (!url) return { ok: false, error: "egress proxy unavailable for a restricted session" };
      policy.egressProxyUrl = url;
    }
  }
  if (entry.agent === "codex") {
    if (!entry.threadId) return { ok: false, error: "codex recovery handle missing" };
    return spawnManagedCodexAisdkSession({
      ...common,
      ...policy,
      key: entry.sessionId,
      resume: entry.threadId,
      thinkingLevel: entry.thinkingLevel ?? undefined,
      serviceTier: managed.serviceTier ?? entry.serviceTier ?? undefined,
    });
  }
  if (entry.agent === "opencode" || entry.agent === "omg") {
    if (!entry.threadId) return { ok: false, error: "opencode recovery handle missing" };
    return spawnManagedOpencodeAisdkSession({
      ...common,
      ...policy,
      key: entry.sessionId,
      resume: entry.threadId,
      thinkingLevel: entry.thinkingLevel ?? undefined,
    });
  }
  if (entry.agent === "pi") {
    if (!entry.threadId) return { ok: false, error: "pi recovery handle missing" };
    return spawnManagedPiSession({
      ...common,
      ...policy,
      key: entry.sessionId,
      resume: entry.threadId,
      thinkingLevel: entry.thinkingLevel ?? undefined,
    });
  }
  if (entry.agent === "grok") {
    if (!entry.threadId) return { ok: false, error: "grok recovery handle missing" };
    return spawnManagedGrokAcpSession({
      ...common,
      key: entry.sessionId,
      resume: entry.threadId,
      thinkingLevel: entry.thinkingLevel ?? undefined,
    });
  }
  if (entry.agent === "cursor") {
    if (!entry.threadId) return { ok: false, error: "cursor recovery handle missing" };
    return spawnManagedCursorAcpSession({ ...common, key: entry.sessionId, resume: entry.threadId });
  }
  if (entry.agent === "fx") {
    if (!entry.threadId) return { ok: false, error: "fx recovery handle missing" };
    return spawnManagedFxAcpSession({ ...common, key: entry.sessionId, resume: entry.threadId });
  }
  if (entry.agent === "muse") {
    if (!entry.threadId) return { ok: false, error: "muse recovery handle missing" };
    return spawnManagedMuseMspSession({
      ...common,
      key: entry.sessionId,
      resume: entry.threadId,
      thinkingLevel: entry.thinkingLevel ?? undefined,
    });
  }
  if (entry.agent === "copilot") {
    if (!entry.threadId) return { ok: false, error: "copilot recovery handle missing" };
    return spawnManagedCopilotSdkSession({
      ...common,
      key: entry.sessionId,
      resume: entry.threadId,
      thinkingLevel: entry.thinkingLevel ?? undefined,
    });
  }
  if (entry.agent === "jcode") {
    if (!entry.threadId) return { ok: false, error: "jcode recovery handle missing" };
    return spawnManagedJcodeSdkSession({
      ...common,
      key: entry.sessionId,
      resume: entry.threadId,
      thinkingLevel: entry.thinkingLevel ?? undefined,
    });
  }
  return spawnManagedAisdkSession({
    ...common,
    ...policy,
    sessionId: entry.sessionId,
    thinkingLevel: entry.thinkingLevel ?? undefined,
    fastMode: managed.fastMode ?? entry.fastMode ?? false,
    claudeAccountId: managed.claudeAccountId,
  });
}

// Reconcile only durable SDK harnesses. A provider turn is never replayed:
// recovery reopens the conversation at an idle boundary and marks it as
// interrupted so the human can inspect the transcript before continuing.
export async function reconcileCommandFileSessions(
  log: (line: string) => void = console.log,
): Promise<RecoveryResult> {
  const bootId = currentBootId();
  const result: RecoveryResult = {
    bootId,
    adopted: 0,
    recovered: 0,
    failed: 0,
    skippedLegacy: 0,
    skippedSchedule: 0,
    recoveredTmux: 0,
  };
  if (!bootId) return result;
  result.recoveredTmux = recoverJcodeSessions(bootId, log);
  const managed = listManaged();
  const assignments = userAssignments();

  for (const entry of listEntries()) {
    const owner = matchingManaged(entry, managed);
    if (!owner) continue;
    const adapter = owner.agent && owner.agent !== "hermes"
      ? CODING_AGENT_ADAPTERS[owner.agent]
      : null;
    if (adapter?.recovery === "process-bound") continue;
    // A scheduled run already did its job. Relaunching it on every wake is
    // how five leftover crons filled a computer_5 box and blocked New session.
    // Self-hosted LFG has no Computer plan — leave those rows alone.
    if (computerAgentAdmissionContext() && isScheduleSpawned(owner.spawnedBy)) {
      patchEntry(entry.sessionId, { recoveryClaimBootId: bootId });
      removeManaged(owner.tmuxName);
      result.skippedSchedule++;
      continue;
    }
    const legacyTmuxAlive = !entry.bootId && tmuxHasSession(entry.tmuxName);
    // PIDs are only meaningful within the boot that recorded them. After a
    // reboot Linux may reuse the number for an unrelated process, so a stale
    // prior-boot PID must never suppress recovery.
    if (isPidAlive(entry.harnessPid) && (entry.bootId === bootId || legacyTmuxAlive)) {
      // Adopt legacy tmux-wrapped harnesses into the boot journal. They keep
      // running until naturally closed; all newly launched harnesses are direct.
      patchEntry(entry.sessionId, {
        bootId,
        supervisor: entry.supervisor ?? (tmuxHasSession(entry.tmuxName) ? "tmux" : "process"),
        recoveryClaimBootId: null,
      });
      addManaged(owner); // also removes stale duplicate owner rows
      result.adopted++;
      continue;
    }
    // Entries created before boot journaling are safe to show in Recent and
    // manually resume, but not safe to auto-launch: we cannot prove which boot
    // or runtime owned them.
    if (!entry.bootId) {
      result.skippedLegacy++;
      continue;
    }
    if (entry.recoveryClaimBootId === bootId) continue;

    const recoveredAt = Date.now();
    patchEntry(entry.sessionId, { recoveryClaimBootId: bootId, recoveredAt });
    const assignedUser = assignments[owner.tmuxName] ?? null;
    const launched = launchRecovered(entry, owner, recoveredAt, assignedUser);
    if (!launched.ok) {
      patchManaged(owner.tmuxName, {
        launchState: "failed",
        launchError: launched.error || "recovery launch failed",
        interruptedAt: recoveredAt,
        recoveredFromBootId: entry.bootId,
      });
      log(`[session-recovery] failed ${entry.sessionId.slice(0, 8)}: ${launched.error || "launch failed"}`);
      result.failed++;
      continue;
    }
    patchManaged(owner.tmuxName, {
      launchState: "running",
      launchError: undefined,
      interruptedAt: recoveredAt,
      recoveredFromBootId: entry.bootId,
    });
    log(`[session-recovery] reopened ${entry.sessionId.slice(0, 8)} after boot without replaying its turn`);
    result.recovered++;
  }
  return result;
}

// A harness can also die while the host stays up: the kernel OOM-kills its
// lfg-agent-<name> unit (MemoryMax=2G, KillMode=control-group), or it crashes.
// Boot reconciliation never sees that, so the session sat with a message in a
// command file no process read until someone relaunched it by hand. A message
// or resume aimed at such a session calls this first.
//
// The claim is the registry entry itself. Everything from the liveness check to
// the spawn is synchronous, so two requests on the serve event loop cannot
// interleave inside it. The claim then covers the gap until the new harness
// writes its own entry (which drops these fields) or dies.
export const HARNESS_RELAUNCH_CLAIM_MS = 60_000;

export type DeadHarnessRelaunch =
  | { state: "unknown" }
  | { state: "alive" }
  | { state: "claimed" }
  | { state: "relaunched"; pid?: number }
  | { state: "failed"; error: string };

export function commandFileHarnessIsDead(
  entry: AisdkEntry,
  bootId: string | null = currentBootId(),
  alive: (pid: number) => boolean = isPidAlive,
): boolean {
  if (!alive(entry.harnessPid)) return true;
  // A pid from another boot may be reused by an unrelated process.
  return !!bootId && !!entry.bootId && entry.bootId !== bootId;
}

export function relaunchDeadCommandFileHarness(
  sessionId: string,
  deps: {
    log?: (line: string) => void;
    now?: () => number;
    alive?: (pid: number) => boolean;
    launch?: typeof launchRecovered;
  } = {},
): DeadHarnessRelaunch {
  const log = deps.log ?? console.log;
  const now = deps.now ?? Date.now;
  const alive = deps.alive ?? isPidAlive;
  const launch = deps.launch ?? launchRecovered;
  const entry = findEntryByAnyId(sessionId);
  if (!entry) return { state: "unknown" };
  const owner = matchingManaged(entry, listManaged());
  if (!owner) return { state: "unknown" };
  const adapter = owner.agent && owner.agent !== "hermes" ? CODING_AGENT_ADAPTERS[owner.agent] : null;
  if (adapter?.recovery === "process-bound") return { state: "unknown" };
  const bootId = currentBootId();
  if (!commandFileHarnessIsDead(entry, bootId, alive)) return { state: "alive" };
  const at = now();
  // A relaunch (this one or a /resume cold start) is already booting.
  const claimedAt = entry.relaunchClaimedAt ?? 0;
  if (
    at - claimedAt < HARNESS_RELAUNCH_CLAIM_MS &&
    (!entry.relaunchClaimPid || alive(entry.relaunchClaimPid))
  ) return { state: "claimed" };
  // A /api/sessions/resume cold start replaced the owner row after this entry
  // was written, and its harness has not registered yet.
  if (owner.createdAt > entry.createdAt && at - owner.createdAt < HARNESS_RELAUNCH_CLAIM_MS)
    return { state: "claimed" };

  patchEntry(entry.sessionId, {
    relaunchClaimedAt: at,
    relaunchClaimPid: null,
    recoveryClaimBootId: bootId,
    recoveredAt: at,
    busy: false,
  });
  const launched = launch(entry, owner, at, userAssignments()[owner.tmuxName] ?? null);
  if (!launched.ok) {
    patchEntry(entry.sessionId, { relaunchClaimedAt: null });
    patchManaged(owner.tmuxName, {
      launchState: "failed",
      launchError: launched.error || "relaunch failed",
      interruptedAt: at,
    });
    log(`[session-recovery] relaunch failed ${entry.sessionId.slice(0, 8)}: ${launched.error || "launch failed"}`);
    return { state: "failed", error: launched.error || "relaunch failed" };
  }
  if (launched.pid) patchEntry(entry.sessionId, { relaunchClaimPid: launched.pid });
  patchManaged(owner.tmuxName, {
    launchState: "running",
    launchError: undefined,
    interruptedAt: at,
  });
  log(`[session-recovery] relaunched dead harness ${entry.sessionId.slice(0, 8)} (pid ${entry.harnessPid} was gone)`);
  return { state: "relaunched", pid: launched.pid };
}
