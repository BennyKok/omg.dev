// Standard game screens. Each takes plain props and has no game rules inside.
// MenuScreen, PauseOverlay, ResultsScreen, UnlocksScreen, SettingsRow, GameButton.
import type { ReactNode } from "react";
import { isUnlocked, type Profile, type Unlock } from "../game/progress";

export function GameButton({ label, onPress, kind = "primary", disabled, autoFocus }: {
  label: string; onPress: () => void; kind?: "primary" | "ghost"; disabled?: boolean; autoFocus?: boolean;
}) {
  return (
    <button type="button" className={`game-button ${kind}`} disabled={disabled} autoFocus={autoFocus} onClick={onPress}>
      {label}
    </button>
  );
}

function Screen({ children, scroll }: { children: ReactNode; scroll?: boolean }) {
  return (
    <main className={`screen${scroll ? " scroll" : ""}`}>
      <div className="column">{children}</div>
    </main>
  );
}

export function MenuScreen({ title, subtitle, art, buttons, footer }: {
  title: string; subtitle?: string; art?: ReactNode; buttons: { label: string; onPress: () => void; kind?: "primary" | "ghost" }[]; footer?: string;
}) {
  return (
    <Screen>
      <div className="center">
        <h1 className="title">{title}</h1>
        {subtitle ? <p className="subtitle">{subtitle}</p> : null}
        {art}
        <div className="stack">
          {buttons.map((b) => <GameButton key={b.label} {...b} />)}
        </div>
        {footer ? <p className="footer">{footer}</p> : null}
      </div>
    </Screen>
  );
}

/** Dim layer over the game. Render it while paused. */
export function PauseOverlay({ onResume, onRestart, onQuit }: { onResume: () => void; onRestart: () => void; onQuit: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-label="Paused">
      <h2 className="title">Paused</h2>
      <div className="stack">
        <GameButton label="Resume" onPress={onResume} autoFocus />
        <GameButton label="Restart" kind="ghost" onPress={onRestart} />
        <GameButton label="Quit to menu" kind="ghost" onPress={onQuit} />
      </div>
    </div>
  );
}

export function ResultsScreen({ profile, title, unlocks, onAgain, onMenu, onUnlocks }: {
  profile: Profile; title?: string; unlocks: readonly Unlock[]; onAgain: () => void; onMenu: () => void; onUnlocks?: () => void;
}) {
  const run = profile.lastRun;
  if (!run) {
    return (
      <Screen>
        <div className="center">
          <h1 className="title">No result yet</h1>
          <div className="stack">
            <GameButton label="Play" onPress={onAgain} />
          </div>
        </div>
      </Screen>
    );
  }
  const fresh = run.newlyUnlocked.map((id) => unlocks.find((u) => u.id === id)).filter((u): u is Unlock => Boolean(u));
  return (
    <Screen>
      <div className="center">
        <h1 className="title">{title ?? (run.won === false ? "Game over" : "Finished!")}</h1>
        <p className="score">{run.score}</p>
        <p className="subtitle">{run.newBest ? "New best score!" : `Best: ${profile.bestScores[run.gameId] ?? run.score}`}</p>
        {run.stats?.map((s) => (
          <div key={s.label} className="stat-row">
            <span className="stat-label">{s.label}</span>
            <span className="stat-value">{s.value}</span>
          </div>
        ))}
        {fresh.map((u) => (
          <div key={u.id} className="unlock-banner">
            <div className="unlock-title">Unlocked: {u.label}</div>
            <div className="stat-label">{u.description}</div>
          </div>
        ))}
        <div className="stack">
          <GameButton label="Play again" onPress={onAgain} />
          {onUnlocks ? <GameButton label="Unlocks" kind="ghost" onPress={onUnlocks} /> : null}
          <GameButton label="Menu" kind="ghost" onPress={onMenu} />
        </div>
      </div>
    </Screen>
  );
}

export function UnlocksScreen({ profile, unlocks, selectedId, onSelect, onBack, renderPreview }: {
  profile: Profile; unlocks: readonly Unlock[]; selectedId?: string; onSelect?: (id: string) => void; onBack: () => void;
  renderPreview?: (u: Unlock, open: boolean) => ReactNode;
}) {
  return (
    <Screen scroll>
      <h1 className="title" style={{ marginTop: 12 }}>Unlocks</h1>
      <div className="cards">
        {unlocks.map((u) => {
          const open = isUnlocked(profile, u.id, unlocks);
          const selected = selectedId === u.id;
          return (
            <button
              type="button"
              key={u.id}
              className={`card${selected ? " selected" : ""}${open ? "" : " locked"}`}
              disabled={!open || !onSelect}
              aria-pressed={selected}
              onClick={() => onSelect?.(u.id)}
            >
              {renderPreview?.(u, open)}
              <span className="card-text">
                <span className="card-title">{open ? u.label : `${u.label} (locked)`}</span>
                <span className="stat-label">{open ? u.description : `Reach a score of ${u.scoreAtLeast} to unlock.`}</span>
              </span>
              {selected ? <span className="card-title">✓</span> : null}
            </button>
          );
        })}
      </div>
      <div className="stack" style={{ alignSelf: "center", padding: 16 }}>
        <GameButton label="Back" kind="ghost" onPress={onBack} />
      </div>
    </Screen>
  );
}

export function SettingsRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="stat-row">
      <span className="card-title">{label}</span>
      <button type="button" role="switch" aria-checked={value} aria-label={label} className="switch" onClick={() => onChange(!value)}>
        <span className="switch-knob" />
      </button>
    </div>
  );
}
