/**
 * The single admission owner for a Computer's agent work.
 *
 * A session launch is not visible in the session list until its managed row is
 * written. Reserving the slot after each caller has read that list closes the
 * otherwise inevitable await race: JavaScript runs this check-and-reserve
 * section atomically between promise continuations.
 */

export type AgentAdmissionContext = {
  /**
   * Plan label, for error copy and the dashboard only.
   *
   * LFG never derives a number from this string. It used to: a plan name was
   * matched against a table baked into the bundle, and any name the table did
   * not know fell through to the free tier's limit of 1. That made every new
   * plan silently broken on every already-shipped Computer until an LFG
   * release, a pin bump and a template rebake caught up, which is exactly what
   * happened to the India Starter plans and, for far longer, to free itself.
   * The control plane owns plan policy; this process only enforces it.
   */
  plan: string;
  limit: number;
  /** Concurrent scheduled runs. Separate from `limit` — a cron must not fill the interactive cap. */
  scheduleLimit: number;
};

export type AgentActivity = {
  busy?: boolean;
  launching?: boolean;
  spawnedBy?: string | null;
  persistent?: boolean;
};

export type AgentMemoryBudget = {
  availableBytes: number;
  reserveBytes: number;
  launchBytes: number;
};

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/**
 * A launch must leave enough memory for LFG, the OS, and the tunnel to keep
 * answering while the agent runtime initializes. Existing processes are
 * already reflected in availableBytes; launchBytes reserves only starts that
 * passed admission but have not consumed their memory yet.
 */
export function agentLaunchMemoryBudget(
  totalBytes: number,
  availableBytes: number,
): AgentMemoryBudget {
  const total = Number.isFinite(totalBytes) ? Math.max(0, totalBytes) : 0;
  const available = Number.isFinite(availableBytes) ? Math.max(0, availableBytes) : 0;
  return {
    availableBytes: available,
    reserveBytes: Math.max(768 * MIB, Math.ceil(total * 0.1)),
    launchBytes: GIB,
  };
}

export function isScheduleSpawned(spawnedBy: string | null | undefined): boolean {
  return spawnedBy === "schedule";
}

/**
 * The control plane's entitlement drop for this Computer.
 *
 * Deliberately NOT the older `/etc/omg/computer-plan`, which carried a bare
 * plan name. Bundles already in the field read that path whole and compare it
 * to a baked list of names, so writing JSON into it would make every shipped
 * Computer — including the paid tiers that work today — fail through to a
 * single agent for as long as the rollout took. A new filename is invisible to
 * those bundles: they keep reading the old file and behaving exactly as they
 * do now, while this one carries the real numbers.
 */
const COMPUTER_ENTITLEMENT_FILE = "/etc/omg/computer-entitlement.json";

/**
 * Sanity ceiling on a supplied limit. Not an entitlement and not a policy — it
 * only stops a malformed or fat-fingered value from turning admission off. The
 * memory budget is still the real gate underneath it.
 */
const MAX_SUPPLIED_LIMIT = 64;

/**
 * A Computer whose entitlement we cannot read admits one agent.
 *
 * This branch is reached only when the control plane HAS provisioned an
 * entitlement and it arrived unreadable, so the box is definitely managed and
 * guessing generously would hand out capacity nobody paid for. Unlike the plan
 * table this replaces, it is loud: a demotion that logs is a demotion someone
 * can find, and the silence of the old fall-through is the reason a broken
 * entitlement survived two plan launches unnoticed.
 */
const UNREADABLE_ENTITLEMENT: AgentAdmissionContext = {
  plan: "unknown",
  limit: 1,
  scheduleLimit: 1,
};

let warnedUnreadable = false;

function readEntitlementSource(entitlementFile: string): string | undefined {
  try {
    // The control plane owns this root-written file and atomically replaces it
    // while LFG is live. Reading it per admission makes plan changes immediate;
    // a process-start environment variable cannot do that.
    return readFileSync(entitlementFile, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Standalone LFG has no entitlement file at all, and neither does a
    // managed Computer in the window between wake and the control plane's
    // first sync, so the bootstrap env stays the bridge for both.
    return code === "ENOENT" ? process.env.LFG_COMPUTER_ENTITLEMENT : "";
  }
}

function positiveInteger(value: unknown, ceiling: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null;
  return Math.min(value, ceiling);
}

/**
 * The per-Computer entitlement, supplied only by the trusted control plane.
 *
 * Returns null for an ordinary self-hosted `lfg serve`, which has no managed
 * entitlement and keeps its own local setting policy.
 */
export function computerAgentAdmissionContext(
  rawEntitlement?: string,
  entitlementFile = COMPUTER_ENTITLEMENT_FILE,
): AgentAdmissionContext | null {
  const source =
    rawEntitlement === undefined ? readEntitlementSource(entitlementFile) : rawEntitlement;
  if (!source?.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") return failUnreadable(source);

  const entitlement = parsed as Record<string, unknown>;
  const limit = positiveInteger(entitlement.limit, MAX_SUPPLIED_LIMIT);
  const scheduleLimit = positiveInteger(entitlement.scheduleLimit, MAX_SUPPLIED_LIMIT);
  if (limit === null || scheduleLimit === null) return failUnreadable(source);

  const plan = typeof entitlement.plan === "string" ? entitlement.plan.trim() : "";
  return { plan: plan || "managed", limit, scheduleLimit };
}

function failUnreadable(source: string): AgentAdmissionContext {
  if (!warnedUnreadable) {
    warnedUnreadable = true;
    console.warn(
      `[admission] unreadable Computer entitlement, holding at ${UNREADABLE_ENTITLEMENT.limit} agent: ${source.trim().slice(0, 200)}`,
    );
  }
  return UNREADABLE_ENTITLEMENT;
}

/**
 * Agents the box is currently paying for.
 *
 * This counts every resident session, not just the ones with a turn in flight.
 * An idle agent is idle in the sense that it is not burning CPU — but its
 * harness, its backend and its MCP servers are all still mapped, which measures
 * at roughly 300-500 MB apiece. Counting only `busy` let a 22 GB box accumulate
 * a dozen silent sessions, pass every admission check on the way, and then OOM:
 * the gate was reading the one number that does not correlate with the resource
 * it was protecting.
 *
 * `launching` still counts even though such a session has no memory yet — it is
 * about to, and admitting against its future footprint is the entire point.
 */
export function residentAgentCount(sessions: readonly AgentActivity[]): number {
  return sessions.length;
}

/** Interactive New-session / resume / fork work. Scheduled runs are a different pool. */
export function interactiveResidentCount(sessions: readonly AgentActivity[]): number {
  return residentAgentCount(
    sessions.filter((session) => !isScheduleSpawned(session.spawnedBy) && !session.persistent),
  );
}

export function scheduleResidentCount(sessions: readonly AgentActivity[]): number {
  return residentAgentCount(sessions.filter((session) => isScheduleSpawned(session.spawnedBy)));
}

/**
 * The count check, disabled — for a caller that has deliberately overruled its
 * own cap (see activationGate's `overLimit`).
 *
 * Deliberately NOT 0, which already means "unlimited" as a SETTING and returns
 * before admission runs at all. This value still goes through `tryAcquire`, so
 * the memory budget, the pending-launch reservations and the serialized
 * transition all keep working; only the number of residents stops mattering.
 */
export const NO_AGENT_LIMIT = Number.POSITIVE_INFINITY;

export type AgentAdmission =
  | { ok: true; release: () => void; reclaimed?: number }
  | { ok: false; reason: "limit"; resident: number; reserved: number }
  | {
      ok: false;
      reason: "memory";
      resident: number;
      reserved: number;
      availableBytes: number;
      requiredBytes: number;
    };

export class AgentAdmissionController {
  private readonly pending = new Map<string, number>();
  private transition: Promise<void> = Promise.resolve();

  /**
   * Serializes the complete inspect -> optional reclaim -> reserve transition.
   * A memory-pressure reclaim awaits process shutdown, so `tryAcquire` alone
   * cannot own that transition atomically. Keeping the queue here makes one
   * controller the sole admission owner even while cleanup is asynchronous.
   */
  async acquire(
    limit: number,
    inspect: () => Promise<{
      sessions: readonly AgentActivity[];
      memory?: AgentMemoryBudget;
      enforceMemory?: boolean;
    }>,
    reclaim?: () => Promise<number>,
  ): Promise<AgentAdmission> {
    let releaseTransition!: () => void;
    const previous = this.transition;
    this.transition = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });
    await previous;
    try {
      let snapshot = await inspect();
      const enforce = { enforceMemory: snapshot.enforceMemory };
      let admission = this.tryAcquire(limit, snapshot.sessions, snapshot.memory, enforce);
      if (!admission.ok && admission.reason === "memory" && reclaim) {
        const reclaimed = await reclaim();
        if (reclaimed > 0) {
          snapshot = await inspect();
          admission = this.tryAcquire(limit, snapshot.sessions, snapshot.memory, {
            enforceMemory: snapshot.enforceMemory,
          });
          if (admission.ok) return { ...admission, reclaimed };
        }
      }
      return admission;
    } finally {
      releaseTransition();
    }
  }

  /**
   * `enforceMemory: false` accounts without gating — the budget is measured and
   * this launch's share of it is reserved, but a shortfall does not refuse.
   *
   * That split exists because a launch admitted WITHOUT a budget used to reserve
   * zero bytes, so three creates in flight looked free to the fourth. Anything
   * that does gate (a Computer, or a self-hosted override) was then reading
   * memory that was already promised away. Every admission now books its share;
   * only the decision to refuse is conditional.
   */
  tryAcquire(
    limit: number,
    sessions: readonly AgentActivity[],
    memory?: AgentMemoryBudget,
    options?: { enforceMemory?: boolean },
  ): AgentAdmission {
    const resident = residentAgentCount(sessions);
    if (resident + this.pending.size >= limit) {
      return { ok: false, reason: "limit", resident, reserved: this.pending.size };
    }

    const reservedBytes = [...this.pending.values()].reduce((sum, bytes) => sum + bytes, 0);
    if (memory && options?.enforceMemory !== false) {
      const availableBytes = Math.max(0, memory.availableBytes - reservedBytes);
      const requiredBytes = memory.reserveBytes + memory.launchBytes;
      if (availableBytes < requiredBytes) {
        return {
          ok: false,
          reason: "memory",
          resident,
          reserved: this.pending.size,
          availableBytes,
          requiredBytes,
        };
      }
    }

    const token = crypto.randomUUID();
    this.pending.set(token, memory?.launchBytes ?? 0);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.pending.delete(token);
      },
    };
  }

  get reserved(): number {
    return this.pending.size;
  }

  get reservedBytes(): number {
    return [...this.pending.values()].reduce((sum, bytes) => sum + bytes, 0);
  }
}
import { readFileSync } from "node:fs";
