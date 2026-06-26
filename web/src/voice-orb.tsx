import { Component, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Room } from "livekit-client";
import { lazyWithReload } from "./lib/lazy-with-reload";
import { haptic } from "./lib/haptics";
import { startElevenVoice, type ElevenHandle } from "./eleven-voice";

// Opt-in: route the orb through ElevenLabs' managed agent (Option B) instead of
// the self-hosted LiveKit worker. The brain (fleet tools, scoping) is identical
// — only the transport differs. Toggle in the browser console:
//   localStorage.setItem("lfg_voice_eleven","1")  // managed agent
//   localStorage.removeItem("lfg_voice_eleven")    // LiveKit (default)
function useElevenManagedAgent(): boolean {
  try {
    return localStorage.getItem("lfg_voice_eleven") === "1";
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// VoiceOrb — a LiveKit room client. Tap to connect: the browser publishes the
// mic as a WebRTC track and the self-hosted Agents worker joins, runs
// VAD→STT→(Haiku session)→TTS, and publishes its reply as a live audio track
// we play directly (no autoplay games). The orb's animation is driven by the
// agent's published state (lk.agent.state). Default: paused. Tap toggles.
// ───────────────────────────────────────────────────────────────────────────

// ElevenLabs' open-source WebGL orb — lazy so three.js stays in its own chunk.
// lazyWithReload recovers from the post-deploy stale-chunk failure that
// otherwise surfaces as React error #306 on the live view.
const Orb = lazyWithReload("Orb", () =>
  import("./eleven-orb").then((m) => ({ default: m.Orb })),
);

// Local boundary: the orb is purely decorative, so if its WebGL chunk is ever
// genuinely broken (not just stale — that self-heals via the reload above), we
// degrade to the CSS placeholder rather than letting React #306 bubble up to
// the app's RootErrorBoundary and blank the entire live view.
class OrbBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type Status = "idle" | "connecting" | "connected";
type AgentState = "listening" | "thinking" | "talking" | "consulting" | null;

// Adapted from SmoothUI's open-source "Siri Orb" (MIT) — pure-CSS placeholder
// shown for the instant the WebGL chunk loads.
const SIRI_ORB_CSS = `
@property --siri-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.siri-orb { display: grid; grid-template-areas: "stack"; overflow: hidden; border-radius: 50%; position: relative; }
.siri-orb::before, .siri-orb::after { content: ""; display: block; grid-area: stack; width: 100%; height: 100%; border-radius: 50%; }
.siri-orb::before {
  background:
    conic-gradient(from calc(var(--siri-angle) * 2) at 25% 70%, var(--siri-c3), transparent 20% 80%, var(--siri-c3)),
    conic-gradient(from calc(var(--siri-angle) * -3) at 80% 20%, var(--siri-c1), transparent 40% 60%, var(--siri-c1)),
    conic-gradient(from calc(var(--siri-angle) * 1) at 20% 80%, var(--siri-c2), transparent 10% 90%, var(--siri-c2));
  filter: blur(4px) contrast(1.5);
  animation: siri-rotate 18s linear infinite;
}
@keyframes siri-rotate { to { --siri-angle: 360deg; } }
@media (prefers-reduced-motion: reduce) { .siri-orb::before { animation: none; } }
`;

function SiriOrb({
  size,
  c1,
  c2,
  c3,
}: {
  size: number | string;
  c1: string;
  c2: string;
  c3: string;
}) {
  return (
    <div
      className="siri-orb"
      style={
        {
          width: size,
          height: size,
          "--siri-c1": c1,
          "--siri-c2": c2,
          "--siri-c3": c3,
        } as CSSProperties
      }
    >
      <style>{SIRI_ORB_CSS}</style>
    </div>
  );
}

// A second tap landing within this window is a double-tap (→ open the New
// Session composer) rather than two separate single taps. The single-tap action
// (connect/disconnect voice) is deferred by this much so we can tell them apart.
const DOUBLE_TAP_MS = 280;
// Drag the orb up past this many px to open the New Session composer.
const SWIPE_UP_DY = 44;
// Press and hold the orb for this long to open the New Session composer in voice
// mode (dictation starts immediately; releasing submits). Moving past this many
// px before it fires cancels the hold — it's a swipe/tap, not a hold.
const LONG_PRESS_MS = 350;
const HOLD_CANCEL_DX = 12;

export function VoiceOrb({
  thinking,
  onCompose,
  onOpenCall,
  onHoldStart,
  onHoldEnd,
  hidden,
}: {
  // Drive the orb's thinking animation from outside a LiveKit call — used while a
  // one-shot orb question is being looked up (explore → spoken answer).
  thinking?: boolean;
  onCompose?: () => void;
  // When provided, a single tap on the idle orb opens phone-call mode (which
  // owns the LiveKit connection) instead of connecting inline here — so there is
  // exactly one room at a time. The composer gestures are unchanged.
  onOpenCall?: () => void;
  // Press-and-hold: onHoldStart fires once the hold threshold is crossed (open
  // the composer + start dictation); onHoldEnd fires on release (stop + submit).
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  // Fade the orb out and make it non-interactive (e.g. while the soft keyboard
  // is up). Kept mounted so the LiveKit/Eleven connection isn't torn down.
  hidden?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [agentState, setAgentState] = useState<AgentState>(null);
  const [caption, setCaption] = useState("");
  // What the agent is doing right now (tool call / thinking), streamed from the
  // worker via the `lfg.tool` participant attribute. Persists while non-empty
  // (the backend clears it when the tool finishes), unlike the transient flash.
  const [detail, setDetail] = useState("");

  const roomRef = useRef<Room | null>(null);
  const elevenRef = useRef<ElevenHandle | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const captionTimer = useRef<number | null>(null);

  const flash = useCallback((msg: string) => {
    setCaption(msg);
    if (captionTimer.current) clearTimeout(captionTimer.current);
    captionTimer.current = window.setTimeout(() => setCaption(""), 4000);
  }, []);

  const disconnect = useCallback(async () => {
    // ElevenLabs managed-agent session (Option B), if that path is active.
    const eleven = elevenRef.current;
    elevenRef.current = null;
    if (eleven) {
      try {
        await eleven.endSession();
      } catch {}
    }
    const room = roomRef.current;
    roomRef.current = null;
    for (const el of audioElsRef.current) {
      try {
        el.pause();
        el.remove();
      } catch {}
    }
    audioElsRef.current = [];
    if (room) {
      try {
        await room.disconnect();
      } catch {}
    }
    setStatus("idle");
    setAgentState(null);
    setDetail("");
  }, []);

  // Backstop watchdog: any busy state ("Thinking…"/"Consulting…"/"Talking…")
  // that never transitions leaves the orb wedged with no event to recover it —
  // e.g. the worker turn never clears its state, an attribute update is dropped
  // over the wire, or TTS produces dead air (the agent finished thinking but no
  // audio ever plays, so "talking" never advances to "listening"). If we sit in
  // a busy state with no transition for too long, fall back to listening (and
  // drop any stale tool detail). The window is generous so a legitimately slow
  // consult on the upper ladder — or a long spoken reply — isn't cut short.
  // Client-side only — backend turn handling is owned by the voice worker.
  useEffect(() => {
    const busy =
      agentState === "thinking" ||
      agentState === "consulting" ||
      agentState === "talking";
    if (!busy) return;
    const t = window.setTimeout(() => {
      setAgentState((s) =>
        s === "thinking" || s === "consulting" || s === "talking"
          ? "listening"
          : s,
      );
      setDetail("");
    }, 100_000);
    return () => clearTimeout(t);
  }, [agentState, detail]);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setAgentState("thinking");
    flash("Connecting…");
    try {
      const res = await fetch("/api/livekit/token");
      if (!res.ok) throw new Error(`token ${res.status}`);
      const { url, token } = (await res.json()) as { url: string; token: string };

      const { Room: RoomCls, RoomEvent, Track } = await import("livekit-client");
      // Explicitly turn on the browser's WebRTC audio cleanup for the mic we
      // publish: echo cancellation (so our own TTS coming back through the
      // speakers can't false-trigger barge-in), noise suppression for steady
      // background noise, and AGC. voiceIsolation is Chrome's stronger neural
      // suppressor — when supported it supersedes noiseSuppression. Without
      // audioCaptureDefaults these are left to UA defaults and uncontrolled.
      const room = new RoomCls({
        adaptiveStream: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: true,
        },
      });
      roomRef.current = room;

      const readAgent = (attrs?: Record<string, string>) => {
        // Stream the live tool-call / thinking detail to the caption bubble.
        // Non-empty while a tool runs; the worker clears it ("") when done.
        setDetail(attrs?.["lfg.tool"] ?? "");
        // A custom "deep work" signal (consulting the advisor / steering another
        // session) overrides the built-in lk.agent.state so the orb can show a
        // distinct transform. Cleared (empty) → fall through to the base state.
        const activity = attrs?.["lfg.activity"];
        if (activity === "consulting" || activity === "replying") {
          setAgentState("consulting");
          return;
        }
        const s = attrs?.["lk.agent.state"];
        if (s === "speaking") setAgentState("talking");
        else if (s === "listening") setAgentState("listening");
        else if (s === "thinking") setAgentState("thinking");
      };

      room.on(RoomEvent.ParticipantAttributesChanged, (_changed, p) =>
        readAgent(p.attributes),
      );
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.autoplay = true;
          el.style.display = "none";
          document.body.appendChild(el);
          audioElsRef.current.push(el);
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current === room) void disconnect();
      });

      await room.connect(url, token);
      // Tell the voice agent which lfg user is speaking so it scopes the fleet
      // (snapshot, list, actions) to them. "__all"/unset → no scoping, whole
      // fleet, as before. The agent reads this off our participant attributes.
      try {
        const user = localStorage.getItem("lfg_user");
        if (user && user !== "__all")
          await room.localParticipant.setAttributes({ "lfg.user": user });
      } catch {}
      // Enabling the mic can reject on iOS Safari (permission not yet granted,
      // or blocked by the autoplay/gesture policy). Do NOT let it bubble to the
      // outer catch — that calls disconnect() and drops the orb ~230ms after it
      // connects. Stay connected and surface a hint; the user can retry the mic.
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        flash("Mic blocked — check permission");
      }
      try {
        await room.startAudio();
      } catch {}
      room.remoteParticipants.forEach((p) => readAgent(p.attributes));

      setStatus("connected");
      setAgentState((s) => s ?? "listening");
      flash("Connected");
    } catch {
      flash("Couldn't connect");
      await disconnect();
    }
  }, [disconnect, flash]);

  // ElevenLabs managed-agent connect (Option B). ElevenLabs owns mic/STT/turn-
  // taking/TTS in the browser; our backend stays the brain via the custom-LLM
  // endpoint. We map the SDK's connect status + turn mode onto the same orb
  // animation states the LiveKit path drives, so the UI is identical.
  const connectEleven = useCallback(async () => {
    setStatus("connecting");
    setAgentState("thinking");
    flash("Connecting…");
    try {
      elevenRef.current = await startElevenVoice({
        onStatus: (s) => {
          if (s === "connected") {
            setStatus("connected");
            setAgentState((a) => a ?? "listening");
            flash("Connected");
          } else if (s === "connecting") {
            setStatus("connecting");
          } else if (s === "idle") {
            if (elevenRef.current) void disconnect();
          } else if (s === "error") {
            flash("Couldn't connect");
          }
        },
        // No explicit "thinking" mode in the SDK: once the user stops talking the
        // agent is computing (our brain + tools) until it starts speaking, so we
        // show "thinking" on a finalized user turn and clear it when it speaks.
        onUserTranscript: (t) => {
          if (t) setAgentState("thinking");
        },
        onMode: (m) => setAgentState(m === "speaking" ? "talking" : "listening"),
        onAgentReply: (t) => {
          if (t) flash(t);
        },
        onError: () => flash("Voice error"),
      });
    } catch {
      flash("Couldn't connect");
      await disconnect();
    }
  }, [disconnect, flash]);

  const toggle = useCallback(() => {
    if (roomRef.current || elevenRef.current || status !== "idle")
      void disconnect();
    else if (useElevenManagedAgent())
      void connectEleven(); // Option B: managed agent, inline on the orb
    else if (onOpenCall) onOpenCall(); // phone-call mode owns the connection
    else void connect();
  }, [status, connect, connectEleven, disconnect, onOpenCall]);

  // Swipe-up gesture: drag the orb up past this many px to open the New Session
  // composer. Tracked from the pointer-down Y; suppresses the tap.
  const startY = useRef(0);
  const startX = useRef(0);
  const swipeFired = useRef(false);
  // Press-and-hold tracking: a timer armed on press-down that, if it survives
  // LONG_PRESS_MS without a tap/swipe/cancel, flips holdFired and starts voice
  // mode. holdFired also suppresses the click that pointerup would otherwise fire.
  const holdTimer = useRef<number | null>(null);
  const holdFired = useRef(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  // End the press only on a genuine pointer lift (or a real system abort),
  // watched on the window — never on the orb's own pointerleave/pointercancel.
  // While holding to dictate, a UI change under the finger (a toast mounting
  // over the orb, audio attaching, or a re-render that drops pointer capture)
  // makes the browser fire pointerleave/pointercancel on the button even though
  // the finger never lifted; wiring those to "release" ended the take early. A
  // window pointerup only fires on a real lift and the window never receives
  // pointerleave, so DOM churn under the finger can't fake a release.
  const endPress = useCallback(() => {
    window.removeEventListener("pointerup", endPress);
    window.removeEventListener("pointercancel", endPress);
    clearHoldTimer();
    // Released after a hold → stop dictation and submit. holdFired stays true so
    // the click that follows pointerup is swallowed by onTap.
    if (holdFired.current) onHoldEnd?.();
  }, [onHoldEnd, clearHoldTimer]);

  const onPressStart = useCallback(
    (e: React.PointerEvent) => {
      swipeFired.current = false;
      holdFired.current = false;
      startY.current = e.clientY;
      startX.current = e.clientX;
      // Capture the pointer so we keep getting moves once the finger slides up off
      // the orb — otherwise the swipe stops being tracked the instant it leaves.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* unsupported — falls back to normal routing */
      }
      // Detect the release on the window, not the element (see endPress) — a
      // pointerup only fires on a real lift, immune to overlays/re-renders.
      window.addEventListener("pointerup", endPress);
      window.addEventListener("pointercancel", endPress);
      // Arm the hold. Firing it opens the composer in voice mode and starts
      // dictation; the matching onHoldEnd on release stops + submits.
      if (onHoldStart) {
        clearHoldTimer();
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          holdFired.current = true;
          haptic("selection");
          onHoldStart();
        }, LONG_PRESS_MS);
      }
    },
    [onHoldStart, clearHoldTimer, endPress],
  );

  const onPressMove = useCallback(
    (e: React.PointerEvent) => {
      // Once the hold has fired we're in voice mode — ignore further movement so
      // a small finger drift can't trip the swipe or cancel the recording.
      if (holdFired.current) return;
      const dy = startY.current - e.clientY;
      const dx = Math.abs(e.clientX - startX.current);
      // Any meaningful movement means this is a swipe/scroll, not a hold.
      if (holdTimer.current !== null && (dx > HOLD_CANCEL_DX || Math.abs(dy) > HOLD_CANCEL_DX)) {
        clearHoldTimer();
      }
      if (swipeFired.current) return;
      if (dy > SWIPE_UP_DY) {
        swipeFired.current = true; // suppress the tap that would follow
        clearHoldTimer();
        onCompose?.(); // swipe up → open the New Session composer
      }
    },
    [onCompose, clearHoldTimer],
  );

  // Distinguish single tap (toggle voice) from double tap (open composer). The
  // first tap arms a short timer; if a second tap arrives before it fires, we
  // cancel the toggle and open the New Session composer instead.
  const tapTimer = useRef<number | null>(null);
  const onTap = useCallback(() => {
    if (holdFired.current) {
      holdFired.current = false;
      return; // this was a press-and-hold, not a tap — voice mode already ran
    }
    if (swipeFired.current) {
      swipeFired.current = false;
      return; // this was a swipe-up, not a tap — composer already opened
    }
    if (tapTimer.current !== null) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      onCompose?.(); // double tap → open the New Session composer
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      toggle();
    }, DOUBLE_TAP_MS);
  }, [toggle, onCompose]);

  useEffect(() => () => void disconnect(), [disconnect]);
  useEffect(
    () => () => {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
      // Drop any window release listeners left armed by an in-flight press.
      window.removeEventListener("pointerup", endPress);
      window.removeEventListener("pointercancel", endPress);
    },
    [endPress],
  );

  const active = status !== "idle";
  // The one-shot "ask a question" flow isn't a LiveKit call, so light the orb up
  // in a thinking state from the `thinking` prop while the lookup runs.
  const busy = !active && !!thinking;
  const lit = active || busy;
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");

  const orbAgentState: AgentState = active
    ? agentState ?? "listening"
    : busy
      ? "thinking"
      : null;
  const colors: [string, string] = !lit
    ? ["#9aa7b8", "#7c8a9c"]
    : orbAgentState === "talking"
      ? ["#bfe3ff", "#7fb4e6"]
      : orbAgentState === "consulting"
        ? ["#ffd79a", "#e6a23c"]
        : orbAgentState === "thinking"
          ? ["#cfc2ff", "#9f8be6"]
          : ["#CADCFC", "#A0B9D1"];

  const label = !lit
    ? "Start voice"
    : status === "connecting"
      ? "Connecting…"
      : orbAgentState === "talking"
        ? "Speaking…"
        : orbAgentState === "consulting"
          ? "Consulting…"
          : orbAgentState === "thinking"
            ? "Thinking…"
            : "Listening…";

  // What the caption bubble shows, in priority order: a transient connection
  // flash, then the live tool-call detail, then a bare thinking/consulting
  // state so the orb always narrates what it's doing.
  const bubble =
    caption ||
    detail ||
    (busy
      ? "Looking into it…"
      : orbAgentState === "consulting"
        ? "Consulting…"
        : orbAgentState === "thinking"
          ? "Thinking…"
          : "");

  const fallback = (
    <SiriOrb
      size="100%"
      c1={colors[0]}
      c2={colors[1]}
      c3={isDark ? "#3a3a44" : "#e8eef7"}
    />
  );

  return (
    <button
      type="button"
      onClick={onTap}
      onPointerDown={onPressStart}
      onPointerMove={onPressMove}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={label}
      aria-pressed={active}
      aria-hidden={hidden}
      tabIndex={hidden ? -1 : undefined}
      title={
        (active ? "Voice — tap to stop" : "Voice — tap to start") +
        " · double-tap or swipe up for new session · hold to dictate a new session, release to send"
      }
      className="pointer-events-auto relative size-9 shrink-0 touch-none select-none rounded-full md:size-8"
      style={{
        filter: lit
          ? "drop-shadow(0 0 20px color-mix(in srgb, #8a7dff 45%, transparent))"
          : "drop-shadow(0 6px 16px rgba(0,0,0,0.22))",
        transition: "filter 200ms, opacity 200ms, translate 200ms",
        // While hidden, fade out, drop below the (now keyboard-covered) edge,
        // and stop catching taps — but stay mounted to keep the voice session.
        // NOTE: Tailwind v4's `-translate-x-1/2` uses the CSS `translate`
        // property, so we override that (not `transform`) to keep the orb
        // horizontally centered — setting `transform` here would stack a second
        // -50% shift and yank the orb to the left.
        opacity: hidden ? 0 : lit ? 1 : 0.92,
        pointerEvents: hidden ? "none" : "auto",
        translate: hidden ? "-50% 120%" : undefined,
      }}
    >
      {lit && bubble ? (
        <span className="pointer-events-none absolute right-0 top-full mt-2">
          <span
            key={bubble}
            className="lfg-bubble block max-w-[60vw] truncate rounded-full bg-foreground/85 px-2.5 py-1 text-[11px] font-medium text-background shadow-lg"
          >
            {bubble}
          </span>
        </span>
      ) : null}
      <OrbBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <Orb
            className="h-full w-full"
            colors={colors}
            agentState={orbAgentState}
            volumeMode="auto"
          />
        </Suspense>
      </OrbBoundary>
    </button>
  );
}
