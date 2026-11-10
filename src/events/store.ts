// Persistence for event hooks. The single owner of:
//   events/hooks.json      the hooks
//   events/seen/<id>.json  the keys a hook has already seen
//   events/log.jsonl       the events that fired (bounded)
//   events/state/<id>/     scratch space for a hook's own scripts
// Writes go through one in-process queue so a save from the API and a
// lastRunAt stamp from the tick cannot overwrite each other.

import { randomBytes } from "node:crypto";
import { appendFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import type { EventHook, OmgEvent } from "./types.ts";

export const SEEN_KEYS_MAX = 2_000;
const LOG_MAX_BYTES = 2 * 1024 * 1024;
const LOG_KEEP_LINES = 2_000;

const dir = () => join(PATHS.data, "events");
const hooksPath = () => join(dir(), "hooks.json");
const seenPath = (id: string) => join(dir(), "seen", `${id}.json`);
const logPath = () => join(dir(), "log.jsonl");

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

export function newEventId(): string {
  return `ev_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "hook";
}

export async function listHooks(): Promise<EventHook[]> {
  const f = Bun.file(hooksPath());
  if (!(await f.exists())) return [];
  try {
    const rows = JSON.parse(await f.text());
    return Array.isArray(rows) ? (rows as EventHook[]) : [];
  } catch {
    return [];
  }
}

export async function getHook(id: string): Promise<EventHook | null> {
  return (await listHooks()).find((h) => h.id === id) ?? null;
}

async function writeHooks(rows: EventHook[]): Promise<void> {
  await mkdir(dir(), { recursive: true });
  await Bun.write(hooksPath(), JSON.stringify(rows, null, 2));
}

/** Create (no id) or replace (id) a hook. A changed source forgets its seen keys, so it starts from now again. */
export function saveHook(
  input: Omit<EventHook, "id" | "createdAt"> & { id?: string },
): Promise<EventHook> {
  return serial(async () => {
    const rows = await listHooks();
    const existing = input.id ? rows.find((h) => h.id === input.id) : undefined;
    if (input.id && !existing) throw new Error(`unknown event hook "${input.id}"`);
    let id = input.id;
    if (!id) {
      id = slug(input.name);
      for (let n = 2; rows.some((h) => h.id === id); n++) id = `${slug(input.name)}-${n}`;
    }
    const sourceChanged = existing && JSON.stringify(existing.source) !== JSON.stringify(input.source);
    const hook: EventHook = {
      ...input,
      id,
      createdBy: existing?.createdBy ?? input.createdBy,
      createdAt: existing?.createdAt ?? Date.now(),
      lastRunAt: sourceChanged ? undefined : existing?.lastRunAt,
      lastEventAt: existing?.lastEventAt,
      lastError: sourceChanged ? undefined : existing?.lastError,
    };
    await writeHooks(existing ? rows.map((h) => (h.id === id ? hook : h)) : [...rows, hook]);
    if (sourceChanged) await rm(seenPath(id), { force: true });
    return hook;
  });
}

export function patchHook(id: string, patch: Partial<Pick<EventHook, "lastRunAt" | "lastEventAt" | "lastError" | "enabled">>): Promise<void> {
  return serial(async () => {
    const rows = await listHooks();
    if (!rows.some((h) => h.id === id)) return;
    await writeHooks(rows.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  });
}

export function deleteHook(id: string): Promise<boolean> {
  return serial(async () => {
    const rows = await listHooks();
    if (!rows.some((h) => h.id === id)) return false;
    await writeHooks(rows.filter((h) => h.id !== id));
    await rm(seenPath(id), { force: true });
    await rm(join(dir(), "state", id), { recursive: true, force: true });
    return true;
  });
}

/** The keys a hook has seen, or null when its source has never been checked. */
export async function loadSeen(id: string): Promise<Set<string> | null> {
  const f = Bun.file(seenPath(id));
  if (!(await f.exists())) return null;
  try {
    const keys = JSON.parse(await f.text());
    return new Set(Array.isArray(keys) ? keys.map(String) : []);
  } catch {
    return new Set();
  }
}

/** Keep the newest SEEN_KEYS_MAX keys. Sources return a bounded window, so older keys no longer reappear. */
export async function saveSeen(id: string, keys: Iterable<string>): Promise<void> {
  const all = [...new Set(keys)];
  await mkdir(join(dir(), "seen"), { recursive: true });
  await Bun.write(seenPath(id), JSON.stringify(all.slice(-SEEN_KEYS_MAX)));
}

export async function appendEvents(events: OmgEvent[]): Promise<void> {
  if (!events.length) return;
  await mkdir(dir(), { recursive: true });
  await appendFile(logPath(), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const size = (await stat(logPath()).catch(() => null))?.size ?? 0;
  if (size > LOG_MAX_BYTES) {
    await serial(async () => {
      const lines = (await Bun.file(logPath()).text()).trimEnd().split("\n");
      await Bun.write(logPath(), lines.slice(-LOG_KEEP_LINES).join("\n") + "\n");
    });
  }
}

export async function listEvents(opts: { hookId?: string; limit?: number } = {}): Promise<OmgEvent[]> {
  const f = Bun.file(logPath());
  if (!(await f.exists())) return [];
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const out: OmgEvent[] = [];
  const lines = (await f.text()).trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const e = JSON.parse(lines[i]) as OmgEvent;
      if (!opts.hookId || e.hookId === opts.hookId) out.push(e);
    } catch {
      // A torn last line from a crash. Skip it.
    }
  }
  return out;
}
