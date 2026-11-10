// The event bus: the one place that decides what is new and what runs.
//
// For each due hook:
//   1. collect   the source returns what is there now
//   2. baseline  the first check only records what exists, so a new hook on a
//                busy repo does not fire for every old issue
//   3. dedupe    keys already seen are dropped
//   4. budget    at most maxRunsPerHour action runs; the rest waits
//   5. stamp     the batch is marked seen BEFORE the action, so a crash cannot
//                repeat it (at most once, like the auto-agent scheduler)
//   6. act       one action run per batch of at most MAX_BATCH events
//
// It runs inside the existing 60 s auto-agent tick: no new process, no new
// port, no new timer. No model runs unless the hook's action starts one.

import { getGlobalSettingsSync } from "../settings.ts";
import { notifyAll } from "../push.ts";
import { mostRecentDue } from "../auto/scheduler.ts";
import { appendEvents, listHooks, loadSeen, newEventId, patchHook, saveSeen } from "./store.ts";
import { scriptSource } from "./sources/script.ts";
import { githubSource } from "./sources/github.ts";
import { sessionAction } from "./actions/session.ts";
import { notifyAction } from "./actions/notify.ts";
import { commandAction } from "./actions/command.ts";
import type { Action, EventHook, KindConfig, NewEvent, OmgEvent, Source, Validated } from "./types.ts";

// The registries. A new kind is one file and one line here.
const SOURCES: Record<string, Source<any>> = {
  [scriptSource.kind]: scriptSource,
  [githubSource.kind]: githubSource,
};
const ACTIONS: Record<string, Action<any>> = {
  [sessionAction.kind]: sessionAction,
  [notifyAction.kind]: notifyAction,
  [commandAction.kind]: commandAction,
};
export const SOURCE_KINDS = Object.keys(SOURCES);
export const ACTION_KINDS = Object.keys(ACTIONS);

export const MAX_BATCH = 20;
export const DEFAULT_SCHEDULE = "*/5 * * * *";
export const DEFAULT_MAX_RUNS_PER_HOUR = 6;
export const MAX_RUNS_PER_HOUR_LIMIT = 60;

function validateKind(
  registry: Record<string, { validate(input: Record<string, unknown>): Validated<KindConfig> }>,
  input: unknown,
  label: string,
): Validated<KindConfig> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: `${label} must be an object with a kind` };
  const kind = (input as { kind?: unknown }).kind;
  const impl = typeof kind === "string" ? registry[kind] : undefined;
  if (!impl) return { ok: false, error: `${label}.kind must be one of: ${Object.keys(registry).join(", ")}` };
  return impl.validate(input as Record<string, unknown>);
}

export type HookInput = Omit<EventHook, "id" | "createdAt"> & { id?: string };

/** Turn an untrusted request body into a hook to save, or an error for the caller. */
export function validateHookInput(body: unknown): { ok: true; hook: HookInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 80) return { ok: false, error: "name is required (at most 80 characters)" };
  const schedule = typeof b.schedule === "string" && b.schedule.trim() ? b.schedule.trim() : DEFAULT_SCHEDULE;
  const fields = schedule.split(/\s+/);
  if (fields.length !== 5 || !fields.every((f) => /^[\d*,/-]+$/.test(f)))
    return { ok: false, error: "schedule must be a 5-field cron expression of numbers, *, -, / and ," };
  const source = validateKind(SOURCES, b.source, "source");
  if (!source.ok) return source;
  const action = validateKind(ACTIONS, b.action, "action");
  if (!action.ok) return action;
  let maxRunsPerHour = DEFAULT_MAX_RUNS_PER_HOUR;
  if (b.maxRunsPerHour !== undefined) {
    maxRunsPerHour = Number(b.maxRunsPerHour);
    if (!Number.isInteger(maxRunsPerHour) || maxRunsPerHour < 1 || maxRunsPerHour > MAX_RUNS_PER_HOUR_LIMIT)
      return { ok: false, error: `maxRunsPerHour must be 1 to ${MAX_RUNS_PER_HOUR_LIMIT}` };
  }
  return {
    ok: true,
    hook: {
      ...(typeof b.id === "string" && b.id ? { id: b.id } : {}),
      name,
      enabled: b.enabled !== false,
      schedule,
      source: source.config,
      action: action.config,
      maxRunsPerHour,
    },
  };
}

/** Run a source once and return what it sees, with no state change. For testing a script before saving it. */
export async function previewSource(input: unknown, hookId = "preview"): Promise<NewEvent[]> {
  const source = validateKind(SOURCES, input, "source");
  if (!source.ok) throw new Error(source.error);
  return SOURCES[source.config.kind].collect(source.config, { hookId });
}

// Action run times in the last hour, per hook. In memory: a restart can at
// most allow one extra hour's budget.
const runs = new Map<string, number[]>();
function takeBudget(hook: EventHook, now: number): boolean {
  const recent = (runs.get(hook.id) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= hook.maxRunsPerHour) {
    runs.set(hook.id, recent);
    return false;
  }
  recent.push(now);
  runs.set(hook.id, recent);
  return true;
}

/** Steps 1 to 6 for one hook. Throws when the source or the action fails. */
export async function processHook(hook: EventHook, now = Date.now()): Promise<{ fired: number; note: string }> {
  const source = SOURCES[hook.source.kind];
  const action = ACTIONS[hook.action.kind];
  if (!source) throw new Error(`unknown source kind "${hook.source.kind}"`);
  if (!action) throw new Error(`unknown action kind "${hook.action.kind}"`);

  const current = new Map<string, NewEvent>();
  for (const item of await source.collect(hook.source, { hookId: hook.id })) {
    if (!current.has(item.key)) current.set(item.key, item);
  }
  const seen = await loadSeen(hook.id);
  if (seen === null) {
    await saveSeen(hook.id, current.keys());
    return { fired: 0, note: `first check: ${current.size} existing item(s) recorded, nothing fired` };
  }
  const fresh = [...current.values()].filter((e) => !seen.has(e.key));
  if (!fresh.length) return { fired: 0, note: "nothing new" };
  if (!takeBudget(hook, now)) return { fired: 0, note: `${fresh.length} new, waiting: ${hook.maxRunsPerHour} runs this hour` };

  const batch: OmgEvent[] = fresh.slice(0, MAX_BATCH).map((e) => ({ ...e, id: newEventId(), hookId: hook.id, at: now }));
  const fired = new Set(batch.map((e) => e.key));
  // Keys still visible move to the end, so the cap drops only keys the source no longer returns.
  const visible = [...current.keys()].filter((k) => seen.has(k) || fired.has(k));
  await saveSeen(hook.id, [...[...seen].filter((k) => !current.has(k)), ...visible]);
  await appendEvents(batch);
  const line = await action.run(batch, hook.action, hook);
  const rest = fresh.length - batch.length;
  return { fired: batch.length, note: rest > 0 ? `${line}; ${rest} more at the next check` : line };
}

/** Process one hook and record the outcome on it. A new failure notifies the owner once. */
export async function runHook(hook: EventHook, onLog: (s: string) => void = () => {}, now = Date.now()) {
  await patchHook(hook.id, { lastRunAt: now });
  try {
    const result = await processHook(hook, now);
    await patchHook(hook.id, { lastError: undefined, ...(result.fired ? { lastEventAt: now } : {}) });
    onLog(`[events] ${hook.id}: ${result.note}`);
    return { ok: true as const, ...result };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await patchHook(hook.id, { lastError: error });
    onLog(`[events] ${hook.id} failed: ${error}`);
    if (!hook.lastError) {
      void notifyAll({
        notification: { title: `Event hook failed: ${hook.name}`, body: error.slice(0, 200), tag: `event-hook-${hook.id}` },
      }).catch(() => {});
    }
    return { ok: false as const, error };
  }
}

let ticking = false;

/** Called from the auto-agent scheduler's 60 s tick. */
export async function eventsTick(onLog: (s: string) => void = () => {}, now = new Date()): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const tz = getGlobalSettingsSync().timeZone;
    for (const hook of await listHooks()) {
      if (!hook.enabled) continue;
      // A short lookback: a polling hook that missed a check runs once now, not a day of catch-up.
      const due = mostRecentDue(hook.schedule, now, tz, 60);
      if (due === null || (hook.lastRunAt && hook.lastRunAt >= due)) continue;
      await runHook(hook, onLog, now.getTime());
    }
  } finally {
    ticking = false;
  }
}
