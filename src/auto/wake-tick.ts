import { autoSchedulerTickNow } from "./scheduler.ts";

export function handleWakeTick(
  tick: () => Promise<unknown> = autoSchedulerTickNow,
): Response {
  queueMicrotask(() => void tick().catch(() => {}));
  return Response.json({ ok: true });
}
