import { runSessionBrain } from "./runner.ts";
import { readSessionBrainConfig } from "./store.ts";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startSessionBrainScheduler(onLog: (line: string) => void = () => {}): void {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const cfg = await readSessionBrainConfig();
      if (!cfg.enabled) return;
      await runSessionBrain({}, onLog);
    } catch (e) {
      onLog(`[session-brain] scheduled run failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  void readSessionBrainConfig().then((cfg) => {
    const ms = cfg.intervalMin * 60_000;
    timer = setInterval(() => void tick(), ms);
    setTimeout(() => void tick(), 15_000);
    onLog(
      `[session-brain] started (${cfg.intervalMin}m interval, enabled=${cfg.enabled ? "on" : "off"}, autoclose=${cfg.autoClose ? "on" : "off"})`,
    );
  });
}
