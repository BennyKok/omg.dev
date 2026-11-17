import { useEffect, useState } from "react";
import type { ReceiverState } from "../lib/linked-devices";

const buttonClass = "rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50";
const quietButton = "rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50";
const selectClass = "rounded-lg border border-border bg-background p-2 text-foreground";

export const SESSION_LENGTHS = [60, 240, 480, 720, 1440];
/** null: never stop for idleness while the session lasts. */
export const IDLE_STOPS: Array<number | null> = [15, 60, 240, null];
const STANDARD_MINUTES = 240;

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function idleLabel(idle: number | null): string {
  return idle === null ? "Never" : durationLabel(idle);
}

/** "1 h 12 min" until a time; "less than a minute" at the end. */
export function timeLeft(at: number, now: number): string {
  const minutes = Math.ceil((at - now) / 60_000);
  return minutes <= 1 ? "less than a minute" : durationLabel(minutes);
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

type Act = (action: string, body?: Record<string, unknown>) => Promise<void>;

/** Start access with one decision: session length and idle stop. Over 4 h needs an explicit long-session choice. */
export function StartAccess({ state, busy, act }: { state: ReceiverState; busy: boolean; act: Act }) {
  const longest = state.longestMinutes ?? STANDARD_MINUTES;
  const standard = state.standardMinutes ?? STANDARD_MINUTES;
  const lengths = SESSION_LENGTHS.filter((m) => m <= longest);
  const last = state.lastChoice;
  const [minutes, setMinutes] = useState(() => (last && lengths.includes(last.minutes) ? last.minutes : 60));
  const [idle, setIdle] = useState<number | null>(() => (last && IDLE_STOPS.includes(last.idle) ? last.idle : 15));
  const [longConfirmed, setLongConfirmed] = useState(false);
  const long = minutes > standard;
  return <>
    <p className="text-xs text-muted-foreground">Starting access allows actions marked “Allowed during access” to run without another prompt. Other actions ask first.</p>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">Session<select aria-label="Session length" value={minutes} onChange={(e) => { setMinutes(Number(e.target.value)); setLongConfirmed(false); }} className={selectClass}>
        {lengths.map((n) => <option key={n} value={n}>{durationLabel(n)}</option>)}
      </select></label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">Stop when idle for<select aria-label="Idle stop" value={idle === null ? "never" : String(idle)} onChange={(e) => setIdle(e.target.value === "never" ? null : Number(e.target.value))} className={selectClass}>
        {IDLE_STOPS.map((n) => <option key={String(n)} value={n === null ? "never" : String(n)}>{n === null ? "Never while the session lasts" : durationLabel(n)}</option>)}
      </select></label>
    </div>
    {long && <label className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-xs">
      <input type="checkbox" aria-label="Allow a long session" checked={longConfirmed} onChange={(e) => setLongConfirmed(e.target.checked)} className="mt-0.5" />
      <span>Allow a long session of {durationLabel(minutes)}. Agents on the other computer can run allowed actions until it ends{idle === null ? "" : ` or stays idle for ${durationLabel(idle)}`}. You can stop it here at any time.</span>
    </label>}
    <button type="button" disabled={busy || !state.actions.length || !!state.otherProcess || (long && !longConfirmed)} className={buttonClass}
      onClick={() => void act("start", { minutes, idle: idle === null ? "never" : idle, ...(long ? { long: true } : {}) })}>Start access</button>
  </>;
}

/** The active grant: a live countdown, one-click Extend, the idle stop, and Stop. */
export function ActiveAccess({ state, busy, act }: { state: ReceiverState; busy: boolean; act: Act }) {
  const now = useNow(true);
  const grant = state.grant;
  const endsAt = grant?.endsAt ?? state.endsAt;
  const idle = grant ? grant.idleMinutes : state.idleMinutes;
  // Extend is offered only when the device can still move the end.
  const roomMinutes = grant ? Math.floor((now + grant.ceilingMinutes * 60_000 - grant.endsAt) / 60_000) : 0;
  const idleText = idle === null ? "No idle stop while the session lasts."
    : grant?.busy ? `An action is running, so the ${durationLabel(idle)} idle stop is paused.`
    : grant?.idleEndsAt ? `Stops after ${durationLabel(idle)} idle, in ${timeLeft(grant.idleEndsAt, now)} if no request runs.`
    : `Stops after ${idle} idle minutes.`;
  return <>
    {endsAt && <p className="text-xs text-muted-foreground" aria-live="off">Ends in <strong className="text-foreground">{timeLeft(endsAt, now)}</strong>, at {new Date(endsAt).toLocaleTimeString()}. {idleText}</p>}
    {grant && <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy || roomMinutes < 1} className={quietButton} onClick={() => void act("extend", { minutes: 60 })}>Extend 1 h</button>
      {grant.ceilingMinutes > STANDARD_MINUTES && roomMinutes >= 240 && <button type="button" disabled={busy} className={quietButton} onClick={() => void act("extend", { minutes: 240 })}>Extend 4 h</button>}
      <label className="flex items-center gap-2 text-sm text-muted-foreground">Idle stop<select aria-label="Change idle stop" disabled={busy} value={idle === null ? "never" : String(idle)} onChange={(e) => void act("idle", { idle: e.target.value === "never" ? "never" : Number(e.target.value) })} className={selectClass}>
        {[...new Set([...IDLE_STOPS, idle])].map((n) => <option key={String(n)} value={n === null ? "never" : String(n)}>{idleLabel(n)}</option>)}
      </select></label>
    </div>}
    {grant && roomMinutes < 1 && <p className="text-xs text-muted-foreground">This session already ends at the longest time one decision allows ({durationLabel(grant.ceilingMinutes)} from now).</p>}
    <button type="button" disabled={busy} className="rounded-lg bg-destructive px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => void act("stop")}>Stop access</button>
  </>;
}
