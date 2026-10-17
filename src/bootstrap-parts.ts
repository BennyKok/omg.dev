// The parts of /api/bootstrap, each with a deadline.
//
// The bootstrap waited for every part before it answered, so the whole first
// screen waited for the slowest one. Right after a Computer woke, the project
// list (a few local file reads, ~10 ms when warm) took 5.3 s, and the session
// list, ready in 0.3 s, waited with it (measured 2026-10-17).
//
// LFG keeps running through a sleep, so it still holds the last answer of
// every part. A part that misses the deadline is answered with that value and
// named in `stale`; the client reloads once more to correct it. A part with no
// earlier answer (the first load after a restart) is awaited as before. A
// failed part answers null, as before.

export type BootstrapParts = Record<string, Promise<unknown>>;

export interface SettledBootstrap {
  values: Record<string, unknown>;
  /** Parts answered with their last known value because they were slow. */
  stale: string[];
  /** Milliseconds until each part answered (its value, last value, or null). */
  timings: Record<string, number>;
  /** Parts that had no earlier value, so the answer waited for them. */
  awaited: string[];
}

export function createBootstrapParts(deadlineMs = 300) {
  const last = new Map<string, unknown>();

  async function settlePart(key: string, task: Promise<unknown>, stale: string[], awaited: string[]): Promise<unknown> {
    const tracked = task.then(
      (value) => {
        last.set(key, value);
        return { ok: true as const, value };
      },
      () => ({ ok: false as const, value: null }),
    );
    if (!last.has(key)) {
      awaited.push(key);
      return (await tracked).value;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), deadlineMs);
    });
    const first = await Promise.race([tracked, late]);
    clearTimeout(timer);
    if (first === "late") {
      stale.push(key);
      return last.get(key);
    }
    return first.value;
  }

  async function settle(parts: BootstrapParts): Promise<SettledBootstrap> {
    const stale: string[] = [];
    const awaited: string[] = [];
    const timings: Record<string, number> = {};
    const started = performance.now();
    const entries = Object.entries(parts);
    const values = await Promise.all(entries.map(async ([key, task]) => {
      const value = await settlePart(key, task, stale, awaited);
      timings[key] = Math.round(performance.now() - started);
      return value;
    }));
    return { values: Object.fromEntries(entries.map(([key], i) => [key, values[i]])), stale, timings, awaited };
  }

  return { settle };
}
