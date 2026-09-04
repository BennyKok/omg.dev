// Following a feedback-driven rewrite of an auto agent's instruction to its
// end. POST /api/auto/agents/:id/refine answers 202 at once — the rewrite is
// a real model call against the agent's repo and routinely runs past a
// minute, longer than a phone keeps a fetch open — and publishes its progress
// as `refine` on the agent. This polls that until it settles, so the toast
// that says "updated" only says it once the new instruction is on disk.

export type AutoAgentRefine =
  | { state: "running"; startedAt: number }
  | { state: "done"; at: number }
  | { state: "failed"; at: number; error: string };

export const REFINE_POLL_MS = 2000;
/** Generous: the rewrite inspects the repo with read-only tools first. */
export const REFINE_WAIT_MS = 15 * 60 * 1000;
/** Consecutive poll failures tolerated — a phone coming back from the lock
 *  screen fails one or two fetches before the network is back. */
export const REFINE_POLL_RETRIES = 5;

export async function waitForRefine(
  fetchStatus: () => Promise<AutoAgentRefine | undefined>,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    retries?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<void> {
  const interval = opts.intervalMs ?? REFINE_POLL_MS;
  const timeout = opts.timeoutMs ?? REFINE_WAIT_MS;
  const retries = opts.retries ?? REFINE_POLL_RETRIES;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const started = now();
  let failures = 0;
  for (;;) {
    let status: AutoAgentRefine | undefined;
    try {
      status = await fetchStatus();
      failures = 0;
    } catch (e) {
      if (++failures > retries) throw e;
      await sleep(interval);
      continue;
    }
    // No state at all: the serve process restarted (the state is in-memory)
    // and took the rewrite with it. Say so instead of spinning forever.
    if (!status) throw new Error("the server restarted before the update finished");
    if (status.state === "done") return;
    if (status.state === "failed") throw new Error(status.error || "the rewrite failed");
    if (now() - started > timeout) {
      throw new Error("still updating — check the agent again in a bit");
    }
    await sleep(interval);
  }
}
