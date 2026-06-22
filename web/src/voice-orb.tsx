import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Room } from "livekit-client";

// ───────────────────────────────────────────────────────────────────────────
// VoiceOrb — a LiveKit room client. Tap to connect: the browser publishes the
// mic as a WebRTC track and the self-hosted Agents worker joins, runs
// VAD→STT→(Haiku session)→TTS, and publishes its reply as a live audio track
// we play directly (no autoplay games). The orb's animation is driven by the
// agent's published state (lk.agent.state). Default: paused. Tap toggles.
// ───────────────────────────────────────────────────────────────────────────

// ElevenLabs' open-source WebGL orb — lazy so three.js stays in its own chunk.
const Orb = lazy(() => import("./eleven-orb").then((m) => ({ default: m.Orb })));

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

function SiriOrb({ size, c1, c2, c3 }: { size: number; c1: string; c2: string; c3: string }) {
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

export function VoiceOrb() {
  const [status, setStatus] = useState<Status>("idle");
  const [agentState, setAgentState] = useState<AgentState>(null);
  const [caption, setCaption] = useState("");
  // What the agent is doing right now (tool call / thinking), streamed from the
  // worker via the `lfg.tool` participant attribute. Persists while non-empty
  // (the backend clears it when the tool finishes), unlike the transient flash.
  const [detail, setDetail] = useState("");

  const roomRef = useRef<Room | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const captionTimer = useRef<number | null>(null);

  const flash = useCallback((msg: string) => {
    setCaption(msg);
    if (captionTimer.current) clearTimeout(captionTimer.current);
    captionTimer.current = window.setTimeout(() => setCaption(""), 4000);
  }, []);

  const disconnect = useCallback(async () => {
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
      const room = new RoomCls({ adaptiveStream: true });
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
      await room.localParticipant.setMicrophoneEnabled(true);
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

  const toggle = useCallback(() => {
    if (roomRef.current || status !== "idle") void disconnect();
    else void connect();
  }, [status, connect, disconnect]);

  // Long-press powers the serverless voice GPU up/down, independent of tap (which
  // joins/leaves the voice session). "on" = keep a Modal container warm (snappy,
  // ~$/hr); "off" = scale to zero (~$0 idle, but ~cold-start on next use). Routed
  // through serve so the scaling token stays server-side.
  const [power, setPower] = useState<"on" | "off" | "pending" | "unknown">(
    "unknown",
  );
  const [warming, setWarming] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const togglePower = useCallback(async () => {
    const next = power === "on" ? "off" : "on";
    setPower("pending");
    try {
      const r = await fetch("/api/voice/power", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on: next === "on" }),
      });
      if (!r.ok) throw new Error(String(r.status));
      if (next === "off") {
        setWarming(false);
        setPower("off");
        flash("Voice GPU powered down");
        return;
      }
      // Powering on: the GPU container cold-starts (~25s). Poll until it answers
      // warm, keeping a "Warming up…" indicator on the orb so the user sees
      // progress instead of dead air.
      setWarming(true);
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        try {
          const h = await fetch("/api/voice/health", { cache: "no-store" });
          if (h.ok && ((await h.json()) as { warm?: boolean })?.warm) {
            setPower("on");
            flash("Voice ready");
            return;
          }
        } catch {
          /* keep polling */
        }
        await new Promise((res) => window.setTimeout(res, 2500));
      }
      setPower("on");
      flash("Voice still warming — give it a moment");
    } catch {
      setPower("unknown");
      flash("Voice GPU toggle failed");
    } finally {
      setWarming(false);
    }
  }, [power, flash]);

  const onPressStart = useCallback(() => {
    longPressFired.current = false;
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      longPressFired.current = true; // suppress the click that follows the release
      void togglePower();
    }, 600);
  }, [togglePower]);

  const onPressEnd = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const onTap = useCallback(() => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return; // this was a long-press, not a tap — don't connect/disconnect
    }
    toggle();
  }, [toggle]);

  useEffect(() => () => void disconnect(), [disconnect]);

  const active = status !== "idle";
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");

  const orbAgentState: AgentState = !active ? null : agentState ?? "listening";
  const colors: [string, string] = !active
    ? ["#9aa7b8", "#7c8a9c"]
    : orbAgentState === "talking"
      ? ["#bfe3ff", "#7fb4e6"]
      : orbAgentState === "consulting"
        ? ["#ffd79a", "#e6a23c"]
        : orbAgentState === "thinking"
          ? ["#cfc2ff", "#9f8be6"]
          : ["#CADCFC", "#A0B9D1"];

  const label = !active
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
    (warming ? "Warming up voice… (~25s)" : "") ||
    caption ||
    detail ||
    (orbAgentState === "consulting"
      ? "Consulting…"
      : orbAgentState === "thinking"
        ? "Thinking…"
        : "");

  const fallback = (
    <SiriOrb
      size={68}
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
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={label}
      aria-pressed={active}
      title={
        (active ? "Voice — tap to stop" : "Voice — tap to start") +
        " · long-press to power the GPU " +
        (power === "on" ? "down" : "up")
      }
      className="pointer-events-auto fixed left-1/2 z-[55] size-[72px] -translate-x-1/2 touch-none select-none rounded-full bottom-[calc(5rem+env(safe-area-inset-bottom))]"
      style={{
        filter: active
          ? "drop-shadow(0 0 20px color-mix(in srgb, #8a7dff 45%, transparent))"
          : "drop-shadow(0 6px 16px rgba(0,0,0,0.22))",
        transition: "filter 200ms",
        opacity: active ? 1 : 0.92,
      }}
    >
      {/* Power dot: green = GPU warm, slate = scaled to zero, amber = toggling.
          Always mounted so it can fade/scale out smoothly when status drops to
          unknown; the registered --dot-* props crossfade between states. */}
      <span
        className="lfg-status-dot pointer-events-none absolute right-0 top-0 size-3"
        data-visible={power !== "unknown"}
        style={
          {
            opacity: power === "unknown" ? 0 : 1,
            transform: power === "unknown" ? "scale(0.4)" : "scale(1)",
            "--dot-from":
              power === "on"
                ? "#4ade80"
                : power === "pending"
                  ? "#fbbf24"
                  : "#94a3b8",
            "--dot-to":
              power === "on"
                ? "#16a34a"
                : power === "pending"
                  ? "#d97706"
                  : "#64748b",
          } as CSSProperties
        }
      />
      {(active || warming) && bubble ? (
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 max-w-[60vw] -translate-x-1/2 truncate rounded-full bg-foreground/85 px-2.5 py-1 text-[11px] font-medium text-background shadow-lg">
          {bubble}
        </span>
      ) : null}
      <Suspense fallback={fallback}>
        <Orb
          className="h-full w-full"
          colors={colors}
          agentState={orbAgentState}
          volumeMode="auto"
        />
      </Suspense>
    </button>
  );
}
