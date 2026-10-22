// Heads-up display over the canvas (2D or 3D): one capsule strip at the top
// with icon badges, hearts, a timer and the pause button. The game rules own
// the numbers; these only show them.
//
//   <Hud onPause={pause}>
//     <HudScore value={score} />
//     <HudHearts lives={2} max={3} />
//     <HudTimer seconds={32} />
//   </Hud>
import type { ReactNode } from "react";
import { Coin, Heart, IconPause, Timer } from "./icons";

/** The strip at the top of the game. Pass `onPause` to put the pause button at its end. */
export function Hud({ children, onPause, tint }: { children: ReactNode; onPause?: () => void; tint?: string }) {
  return (
    <div className="hud">
      <div className="hud-strip" style={tint ? { boxShadow: `inset 0 0 0 2px ${tint}` } : undefined}>
        {children}
        {onPause ? <PauseButton onPress={onPause} /> : null}
      </div>
    </div>
  );
}

/** An icon badge and a number. The number pops when it changes. */
export function HudStat({ icon, value, label, color }: { icon?: ReactNode; value: string | number; label: string; color?: string }) {
  return (
    <div className="hud-stat" aria-label={`${label}: ${value}`}>
      {icon ? <span className="hud-icon">{icon}</span> : <span className="hud-label">{label}</span>}
      {/* key: a new value mounts a new span, which replays the pop animation. */}
      <span key={String(value)} className="hud-value" style={color ? { color } : undefined} aria-hidden="true">{value}</span>
    </div>
  );
}

export const HudScore = ({ value, label = "Score" }: { value: number; label?: string }) => (
  <HudStat icon={<Coin size={30} />} value={value.toLocaleString("en-US")} label={label} />
);

export function HudHearts({ lives, max }: { lives: number; max: number }) {
  return (
    <div className="hud-stat hearts" aria-label={`Lives: ${lives} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <Heart key={i} size={26} empty={i >= lives} className={i === lives ? "lost" : undefined} />
      ))}
    </div>
  );
}

/** 32 -> "00:32". */
export const clock = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const HudTimer = ({ seconds }: { seconds: number }) => (
  <HudStat icon={<Timer size={28} />} value={clock(seconds)} label="Time left" />
);

/** A bar from 0 to 1, for health, fuel or a charge. */
export function HudMeter({ label, value, color = "var(--good)" }: { label: string; value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="hud-meter" role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="hud-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** The round pause button. Escape does the same. */
export function PauseButton({ onPress }: { onPress: () => void }) {
  return (
    <button type="button" aria-label="Pause" className="pause-button" onClick={onPress}>
      <IconPause size={22} />
    </button>
  );
}

/** Big centre text such as "3", "GO!" or "Lap 2". */
export function Banner({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="banner" aria-live="polite">
      <span key={text}>{text}</span>
    </div>
  );
}
