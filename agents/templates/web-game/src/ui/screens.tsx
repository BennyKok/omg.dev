// Standard game screens, shared by 2D and 3D games. Each takes plain props and
// has no game rules inside. The look comes from theme.ts through styles.css.
//
// GameButton, IconButton, SoundButton, Screen, MenuScreen, PauseOverlay,
// ResultsScreen, UnlocksScreen, HelpScreen, ChallengeDialog, RotateNotice.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { challengeOutcome, cleanName, MAX_NAME } from "../game/challenge";
import { isUnlocked, type Profile, type Unlock } from "../game/progress";
import { Logo } from "./art";
import {
  Crown, IconBack, IconCheck, IconClose, IconHome, IconLock, IconPlay, IconRestart, IconShare, IconSound, IconSwords, Star,
} from "./icons";
import { profileStore, useProfile } from "./profile-store";
import { sound } from "./sound";

export type ButtonKind = "primary" | "secondary" | "surface";

/** The kit button. "primary" is the big main action (Play), "secondary" the coloured second one, "surface" the quiet ones. */
export function GameButton({ label, onPress, kind = "primary", icon, size = "md", disabled, autoFocus, className }: {
  label: string; onPress: () => void; kind?: ButtonKind; icon?: ReactNode; size?: "lg" | "md" | "sm";
  disabled?: boolean; autoFocus?: boolean; className?: string;
}) {
  return (
    <button
      type="button"
      className={`game-button ${kind} ${size}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      autoFocus={autoFocus}
      onClick={() => {
        sound.play("tap");
        onPress();
      }}
    >
      {icon ? <span className="button-icon">{icon}</span> : null}
      <span className="button-label">{label}</span>
    </button>
  );
}

/** A round 48 px button with only an icon. `label` is read by screen readers. */
export function IconButton({ label, onPress, children, pressed }: { label: string; onPress: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button type="button" className="icon-button" aria-label={label} aria-pressed={pressed} onClick={onPress}>
      {children}
    </button>
  );
}

/** Mute and unmute. The choice is saved on this device. */
export function SoundButton() {
  const on = useProfile().settings.sound;
  return (
    <IconButton label={on ? "Mute sound" : "Turn sound on"} pressed={!on} onPress={() => sound.setOn(!on)}>
      <IconSound muted={!on} />
    </IconButton>
  );
}

/** A full screen with the background art slot. `scroll` lets long content scroll. */
export function Screen({ children, scroll, background, className }: { children: ReactNode; scroll?: boolean; background?: string; className?: string }) {
  return (
    <main className={`screen${scroll ? " scroll" : ""}${className ? ` ${className}` : ""}`}>
      <div className={`screen-bg${background ? " has-image" : ""}`} style={background ? { backgroundImage: `url("${background}")` } : undefined} aria-hidden="true" />
      <div className="column">{children}</div>
    </main>
  );
}

/** Icon buttons in the top corners of a screen. */
export function TopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="top-bar">
      <div className="top-side">{left}</div>
      <div className="top-side">{right}</div>
    </div>
  );
}

/**
 * The menu: logo, hero art, a note (such as a friend's challenge), and the
 * buttons at the bottom where the thumb reaches.
 */
export function MenuScreen({ name, logo, hero, tagline, note, top, children, background, footer }: {
  name: string; logo?: string; hero?: ReactNode; tagline?: string; note?: ReactNode; top?: ReactNode;
  children: ReactNode; background?: string; footer?: ReactNode;
}) {
  return (
    <Screen background={background} className="menu">
      {top}
      <div className="menu-head">
        <Logo name={name} image={logo} />
        {tagline ? <p className="tagline">{tagline}</p> : null}
      </div>
      <div className="menu-hero">{note ?? hero}</div>
      <div className="menu-actions">
        {children}
        {footer ? <div className="menu-footer">{footer}</div> : null}
      </div>
    </Screen>
  );
}

/** A "‹ Players: 1 ›" pill. */
export function Stepper({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="stepper-arrow" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <IconBack size={22} />
      </button>
      <span className="stepper-value">{label}: {value}</span>
      <button type="button" className="stepper-arrow" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <IconBack size={22} style={{ transform: "rotate(180deg)" }} />
      </button>
    </div>
  );
}

/** Dim layer over the game. Render it while paused. */
export function PauseOverlay({ onResume, onRestart, onQuit }: { onResume: () => void; onRestart: () => void; onQuit: () => void }) {
  const on = useProfile().settings.sound;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Paused">
      <div className="panel">
        <h2 className="heading">Paused</h2>
        <div className="stack">
          <GameButton label="Resume" icon={<IconPlay />} onPress={onResume} autoFocus />
          <GameButton label="Restart" kind="surface" icon={<IconRestart />} onPress={onRestart} />
          <GameButton label={on ? "Sound: on" : "Sound: off"} kind="surface" icon={<IconSound muted={!on} />} onPress={() => sound.setOn(!on)} />
          <GameButton label="Quit to menu" kind="surface" icon={<IconHome />} onPress={onQuit} />
        </div>
      </div>
    </div>
  );
}

export type ResultsActions = {
  onAgain: () => void;
  onMenu: () => void;
  onUnlocks?: () => void;
  onShare?: () => void;
  onChallenge?: () => void;
  onSendBack?: () => void;
};

/**
 * Results after a round. It reads `profile.lastRun` and adapts to the mode:
 * free play (score, best, new unlock), daily (number and streak), challenge
 * ("You won" or "You lost" with both scores and "Send it back").
 */
export function ResultsScreen({ profile, unlocks, renderItem, background, actions }: {
  profile: Profile; unlocks: readonly Unlock[]; renderItem?: (u: Unlock) => ReactNode; background?: string; actions: ResultsActions;
}) {
  const run = profile.lastRun;
  if (!run) {
    return (
      <Screen background={background}>
        <div className="center">
          <h1 className="heading big">No result yet</h1>
          <div className="stack"><GameButton label="Play" size="lg" icon={<IconPlay />} onPress={actions.onAgain} /></div>
        </div>
      </Screen>
    );
  }
  const fresh = run.newlyUnlocked.map((id) => unlocks.find((u) => u.id === id)).filter((u): u is Unlock => Boolean(u) && u!.scoreAtLeast > 0);
  const item = fresh[fresh.length - 1];
  const c = run.mode === "challenge" ? run.challenge : undefined;
  const outcome = c ? challengeOutcome(run.score, c.score) : null;
  const heading = outcome === "won" ? "You won!" : outcome === "lost" ? "You lost" : outcome === "tie" ? "It's a tie!" : run.mode === "daily" ? `Daily #${run.dayNumber ?? 1} done!` : run.title ?? "Finished!";
  const best = profile.bestScores[run.gameId] ?? run.score;
  return (
    <Screen background={background} className="results">
      <h1 className={`heading big results-title${outcome === "lost" ? " sad" : ""}`}>{heading}</h1>
      {c ? (
        <div className="score-card versus">
          <div className={`versus-side${outcome !== "lost" ? " winner" : ""}`}>
            <span className="versus-name">You</span>
            <span className="score-number small">{run.score.toLocaleString("en-US")}</span>
          </div>
          <span className="versus-vs">vs</span>
          <div className={`versus-side${outcome === "lost" ? " winner" : ""}`}>
            <span className="versus-name">{c.name}</span>
            <span className="score-number small">{c.score.toLocaleString("en-US")}</span>
          </div>
        </div>
      ) : (
        <div className="score-card">
          <Crown className="score-crown" size={40} />
          <div className="score-row"><Star size={26} /><span className="score-number">{run.score.toLocaleString("en-US")}</span><Star size={26} /></div>
          {run.newBest ? <p className="best-line new">New best score!</p> : <p className="best-line">Best: {best.toLocaleString("en-US")}</p>}
          {run.mode === "daily" ? <p className="streak-line">{profile.daily.streak} day streak</p> : null}
        </div>
      )}
      {item ? (
        <div className="unlock-card">
          <span className="unlock-badge"><Star size={18} />Unlocked<Star size={18} /></span>
          <div className="unlock-art">{renderItem?.(item)}</div>
          <span className="unlock-name">{item.label}</span>
        </div>
      ) : null}
      <div className="results-actions">
        {c ? (
          <>
            {actions.onSendBack ? <GameButton label="Send it back" size="lg" icon={<IconShare />} onPress={actions.onSendBack} /> : null}
            <GameButton label="Play again" kind={actions.onSendBack ? "secondary" : "primary"} icon={<IconPlay />} onPress={actions.onAgain} />
          </>
        ) : (
          <>
            <GameButton label="Play again" size="lg" icon={<IconPlay />} onPress={actions.onAgain} />
            <div className="button-row">
              {actions.onShare ? <GameButton label="Share" kind="secondary" icon={<IconShare />} onPress={actions.onShare} /> : null}
              {actions.onChallenge && run.mode !== "daily" ? <GameButton label="Challenge" kind="secondary" icon={<IconSwords />} onPress={actions.onChallenge} /> : null}
            </div>
          </>
        )}
        <div className="button-row">
          {actions.onUnlocks ? <GameButton label="Unlocks" kind="surface" icon={<IconLock />} onPress={actions.onUnlocks} /> : null}
          <GameButton label="Menu" kind="surface" icon={<IconHome />} onPress={actions.onMenu} />
        </div>
      </div>
    </Screen>
  );
}

export function UnlocksScreen({ profile, unlocks, selectedId, onSelect, onBack, renderItem, background }: {
  profile: Profile; unlocks: readonly Unlock[]; selectedId?: string; onSelect?: (id: string) => void; onBack: () => void;
  renderItem?: (u: Unlock, open: boolean) => ReactNode; background?: string;
}) {
  const open = unlocks.filter((u) => isUnlocked(profile, u.id, unlocks)).length;
  return (
    <Screen scroll background={background} className="unlocks">
      <div className="page-head">
        <IconButton label="Back" onPress={onBack}><IconBack /></IconButton>
        <h1 className="heading">Unlocks</h1>
        <span className="page-count">{open}/{unlocks.length}</span>
      </div>
      <div className="cards">
        {unlocks.map((u) => {
          const isOpen = isUnlocked(profile, u.id, unlocks);
          const selected = selectedId === u.id;
          return (
            <button
              type="button"
              key={u.id}
              className={`card${selected ? " selected" : ""}${isOpen ? "" : " locked"}`}
              disabled={!isOpen || !onSelect}
              aria-pressed={selected}
              onClick={() => onSelect?.(u.id)}
            >
              <span className="card-art">{renderItem?.(u, isOpen)}</span>
              <span className="card-title">{u.label}</span>
              <span className="card-text">{isOpen ? u.description : `Score ${u.scoreAtLeast} to unlock`}</span>
              {selected ? <span className="card-check" aria-hidden="true"><IconCheck size={18} /></span> : null}
              {!isOpen ? <span className="card-lock" aria-hidden="true"><IconLock size={18} /></span> : null}
            </button>
          );
        })}
      </div>
    </Screen>
  );
}

/** How to play, tips and the FAQ (from src/app/about.ts). */
export function HelpScreen({ name, steps, tips, faq, onBack, background }: {
  name: string; steps: string[]; tips: string[]; faq: { q: string; a: string }[]; onBack: () => void; background?: string;
}) {
  return (
    <Screen scroll background={background} className="help">
      <div className="page-head">
        <IconButton label="Back" onPress={onBack}><IconBack /></IconButton>
        <h1 className="heading">How to play</h1>
        <span className="page-count" />
      </div>
      <section className="text-card">
        <ol className="steps">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
      </section>
      {tips.length ? (
        <section className="text-card">
          <h2 className="subheading">Tips</h2>
          <ul className="tips">{tips.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      ) : null}
      <section className="text-card">
        <h2 className="subheading">{name}: questions and answers</h2>
        {faq.map((f) => (
          <details key={f.q} className="faq">
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>
    </Screen>
  );
}

/** Asks for the player's name (saved), then sends the challenge link. */
export function ChallengeDialog({ score, onSend, onClose }: { score: number; onSend: (name: string) => void; onClose: () => void }) {
  const saved = useProfile().settings.name;
  const [name, setName] = useState(saved);
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => field.current?.focus(), []);
  const send = () => {
    const clean = cleanName(name);
    profileStore.setSettings({ name: clean });
    onSend(clean);
  };
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Challenge a friend" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="panel">
        <div className="panel-head">
          <h2 className="heading">Challenge a friend</h2>
          <IconButton label="Close" onPress={onClose}><IconClose /></IconButton>
        </div>
        <p className="panel-text">Your friend plays the same level and tries to beat {score.toLocaleString("en-US")}.</p>
        <label className="field">
          <span>Your name</span>
          <input
            ref={field}
            value={name}
            maxLength={MAX_NAME}
            placeholder="Your name"
            autoComplete="nickname"
            enterKeyHint="send"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
        </label>
        <div className="stack">
          <GameButton label="Send challenge" icon={<IconShare />} onPress={send} />
        </div>
      </div>
    </div>
  );
}

/** "Rotate your phone": shows only on a phone held sideways, for portrait games. */
export function RotateNotice() {
  return (
    <div className="rotate-notice" role="alert">
      <div className="rotate-phone" aria-hidden="true" />
      <p>Rotate your phone</p>
      <span>This game plays upright.</span>
    </div>
  );
}
