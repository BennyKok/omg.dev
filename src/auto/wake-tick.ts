import { autoSchedulerTickNow } from "./scheduler.ts";

export function handleWakeTick(
  onLog: (line: string) => void = () => {},
  tick: (logger: (line: string) => void) => Promise<unknown> = autoSchedulerTickNow,
): Response {
  queueMicrotask(() => void tick(onLog).catch(() => {}));
  return Response.json({ ok: true });
}
