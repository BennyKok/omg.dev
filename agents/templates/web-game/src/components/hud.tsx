// Heads-up display pieces, drawn as HTML over the canvas. `Hud` is a row at
// the top of its parent: put it inside the element that holds the game, after
// the canvas. They show values; the game rules own the numbers.
import type { ReactNode } from "react";
import { theme } from "../game/theme";

export function HudStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="hud-stat">
      <span className="hud-label">{label}</span>
      <span className="hud-value" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

/** A bar from 0 to 1, for health, fuel, damage or a timer. */
export function HudBar({ label, value, color = theme.good }: { label: string; value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="hud-bar">
      <span className="hud-label">{label}</span>
      <div className="hud-track">
        <div className="hud-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function Hud({ children }: { children: ReactNode }) {
  return <div className="hud">{children}</div>;
}

/** Big centre text such as "3", "GO!" or "Lap 2". */
export function Banner({ text, color = theme.accent }: { text: string | null; color?: string }) {
  if (!text) return null;
  return (
    <div className="banner">
      <span style={{ color }}>{text}</span>
    </div>
  );
}
