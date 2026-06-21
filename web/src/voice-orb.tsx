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
  }, []);

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
      onClick={toggle}
      aria-label={label}
      aria-pressed={active}
      title={active ? "Voice — tap to stop" : "Voice — tap to start"}
      className="pointer-events-auto fixed left-1/2 z-[55] size-[72px] -translate-x-1/2 rounded-full bottom-[calc(5rem+env(safe-area-inset-bottom))]"
      style={{
        filter: active
          ? "drop-shadow(0 0 20px color-mix(in srgb, #8a7dff 45%, transparent))"
          : "drop-shadow(0 6px 16px rgba(0,0,0,0.22))",
        transition: "filter 200ms",
        opacity: active ? 1 : 0.92,
      }}
    >
      {active && caption ? (
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 max-w-[60vw] -translate-x-1/2 truncate rounded-full bg-foreground/85 px-2.5 py-1 text-[11px] font-medium text-background shadow-lg">
          {caption}
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
