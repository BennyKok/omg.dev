/**
 * Dictation: hold the mic, speak, get text in the composer — live, not just
 * at the end.
 *
 * THE FINAL TRANSCRIPT STILL HAPPENS ON THE COMPUTER, not on the phone. What
 * changed from the file-only version of this hook: the machine's realtime
 * bridge at `/api/voice/stt-stream` (the same websocket the web composer's
 * dictation speaks — see lfg-serve's src/voice-providers.ts, "Streaming-STT
 * bridge") now gets 16 kHz mono PCM16 frames as we capture them, and streams
 * partial/final transcripts back while you're still talking. The whole-file
 * POST to `/api/voice/stt` survives as the fallback for a box with no
 * realtime provider configured (no ElevenLabs key) or a socket that drops —
 * see stop() below.
 *
 * WHY @siteed/audio-studio AND NOT expo-audio: expo-audio records to a file
 * and never hands JS a buffer — fine for the old whole-file path, useless for
 * streaming. Two candidates were evaluated to replace it:
 *   - expo-audio-stream (RubricLab): last published 2024-09-30, stalled at
 *     0.1.13. No release in the time this app has existed. Rejected — a
 *     realtime feature is exactly the wrong place to depend on something
 *     abandoned; the day it breaks against a future SDK bump, it breaks a
 *     feature that only works while recording, which is the hardest kind of
 *     regression to notice in review.
 *   - @siteed/expo-audio-studio: this used to be the name, but the package is
 *     now a deprecated re-export shim; the real package is
 *     @siteed/audio-studio (github.com/deeeed/audiolab), releases through
 *     2026-06-20, built on ExpoModulesCore (New Architecture by default since
 *     SDK 53, which is what this app is already on) and ships an
 *     `onAudioStream` callback that hands raw PCM16 while a WAV file is
 *     STILL being written to disk at the same time. That dual output is why
 *     one recording session now serves both this hook's paths: the same take
 *     that streams live also lands a file, so a socket failure mid-recording
 *     falls back to a real, complete recording rather than nothing.
 *
 * WAV, 16 kHz, mono, 16-bit — unchanged from before. It is what the batch
 * endpoint's contract asks for and what its streaming sibling already
 * speaks, so no format negotiation exists on either path.
 *
 * AVAudioSession is audio-studio's problem now, not this file's. expo-audio
 * left the session in a playback category until told otherwise (a whole
 * paragraph used to live here about the mic button silently doing nothing
 * because of it) — audio-studio sets `.playAndRecord` on start and
 * deactivates on stop internally, so there is no manual mode dance to get
 * wrong here.
 */

import {
  AudioStudioModule,
  useAudioRecorder,
  type AudioDataEvent,
} from "@siteed/audio-studio";
import type { OmgSocket, OmgTransport } from "@omg-dev/client";
import { useCallback, useEffect, useRef, useState } from "react";

const SAMPLE_RATE = 16000;
const STREAM_CHUNK_MS = 100;
// How long stop() waits for the bridge's trailing "final" after it asks the
// upstream to commit. Long enough for a real round trip, short enough that a
// dead socket doesn't make the send button hang.
const FINAL_WAIT_MS = 4000;

const WS_CONNECTING = 0;
const WS_OPEN = 1;

export type DictationState = "idle" | "recording" | "transcribing";

// ---------------------------------------------------------------- base64

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < BASE64_CHARS.length; i++) table[BASE64_CHARS.charCodeAt(i)] = i;
  return table;
})();

/**
 * `atob` is not a guaranteed global under Hermes, and this runs once per
 * audio chunk for the whole life of a recording — a missing global would
 * silently drop every frame rather than fail anywhere visible. Small enough
 * to own outright rather than add a dependency for it.
 */
function base64ToBytes(base64: string): Uint8Array {
  let end = base64.length;
  while (end > 0 && base64.charCodeAt(end - 1) === 61 /* '=' */) end--;

  const outLength = Math.floor((end * 3) / 4);
  const out = new Uint8Array(outLength);
  let o = 0;
  for (let i = 0; i < end; i += 4) {
    const c0 = BASE64_LOOKUP[base64.charCodeAt(i)] ?? 0;
    const c1 = i + 1 < end ? BASE64_LOOKUP[base64.charCodeAt(i + 1)] : 0;
    const c2 = i + 2 < end ? BASE64_LOOKUP[base64.charCodeAt(i + 2)] : 0;
    const c3 = i + 3 < end ? BASE64_LOOKUP[base64.charCodeAt(i + 3)] : 0;
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < outLength) out[o++] = (triple >> 16) & 0xff;
    if (o < outLength) out[o++] = (triple >> 8) & 0xff;
    if (o < outLength) out[o++] = triple & 0xff;
  }
  return out;
}

/** RMS over signed PCM16 LE samples, curved with sqrt so quiet speech still
 * moves a linear meter — the same shape a dB-based meter gives you, without
 * needing decibels. */
function rmsLevel(bytes: Uint8Array): number {
  const sampleCount = bytes.length >> 1;
  if (sampleCount === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    let sample = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    if (sample >= 0x8000) sample -= 0x10000;
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return Math.min(1, Math.sqrt(rms / 32768));
}

/**
 * @param transport The selected computer's `client.transport` — same object
 * the rest of the app already holds, not a narrower fetch shim. Both halves
 * of this hook need it: `.fetch` for the batch fallback POST, `.openSocket`
 * for the realtime bridge, and the grant that authenticates both lives only
 * there. Building a second auth path for the socket was explicitly out of
 * scope for this change.
 */
export function useDictation(
  transport: OmgTransport | null,
  onText: (text: string) => void,
) {
  const recorder = useAudioRecorder();
  const [state, setState] = useState<DictationState>("idle");
  // Live 0..1 input amplitude for a UI meter. Name and range match what
  // expo-audio's metering used to hand the composer, so the meter built
  // against it keeps working unchanged.
  const [level, setLevel] = useState(0);
  // The live, not-yet-committed transcript. Cleared on each committed chunk
  // and on stop.
  const [partial, setPartial] = useState("");
  // Honest fallback signal: true only once the realtime bridge for the
  // CURRENT take is open and usable. False covers every other case — no
  // provider configured, the socket never opened, it dropped mid-take — so a
  // caller can tell "live" from "will transcribe after you stop" without
  // guessing from `state` alone.
  const [live, setLive] = useState(false);

  const socketRef = useRef<OmgSocket | null>(null);
  const socketBrokenRef = useRef(false);
  const pendingRef = useRef<Uint8Array[]>([]);
  const committedRef = useRef("");
  // Resolvers waiting on the next "final" frame, settled by the flush stop()
  // sends — mirrors the web composer's finalWaiters so a stop() doesn't hand
  // back a clipped partial instead of the tail the bridge is about to commit.
  const finalWaitersRef = useRef<Array<() => void>>([]);

  const settleFinalWaiters = useCallback(() => {
    const waiters = finalWaitersRef.current;
    finalWaitersRef.current = [];
    for (const resolve of waiters) resolve();
  }, []);

  const closeSocket = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // Already gone; nothing to clean up.
      }
    }
  }, []);

  // A component that unmounts mid-recording must not leave a socket open
  // against a machine nobody is listening to any more.
  useEffect(() => closeSocket, [closeSocket]);

  const start = useCallback(async () => {
    if (state !== "idle" || !transport) return;

    const permission = await AudioStudioModule.requestPermissionsAsync();
    if (!permission?.granted) return;

    setState("recording");
    setPartial("");
    setLevel(0);
    setLive(false);
    committedRef.current = "";
    socketBrokenRef.current = false;
    pendingRef.current = [];
    finalWaitersRef.current = [];

    // Open the realtime bridge FIRST — see stt-stream in serve.ts: a machine
    // with no realtime provider configured accepts the upgrade and then
    // closes the socket immediately with nothing sent. That is not an error,
    // it is the documented fallback signal, so it is handled the same way as
    // a socket that never manages to open at all: `live` just never goes
    // true, and stop() falls through to the batch path.
    try {
      const socket = await transport.openSocket("/api/voice/stt-stream");
      socketRef.current = socket;
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => {
        setLive(true);
        const pending = pendingRef.current;
        pendingRef.current = [];
        for (const chunk of pending) {
          try {
            socket.send(chunk);
          } catch {
            break;
          }
        }
      });
      socket.addEventListener("message", (event) => {
        let msg: { type?: string; text?: string };
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return; // Not JSON — one bad frame should not end a live take.
        }
        if (msg.type === "partial") {
          setPartial(msg.text ?? "");
        } else if (msg.type === "final") {
          const text = msg.text ?? "";
          committedRef.current = committedRef.current
            ? text
              ? `${committedRef.current} ${text}`
              : committedRef.current
            : text;
          setPartial("");
          settleFinalWaiters();
        }
      });
      socket.addEventListener("close", () => {
        setLive(false);
        socketBrokenRef.current = true;
        settleFinalWaiters();
      });
      socket.addEventListener("error", () => {
        socketBrokenRef.current = true;
      });
    } catch {
      // openSocket itself rejected (offline, transport doesn't support it,
      // grant mint failed). The file this recording is about to write is the
      // fallback below.
      socketRef.current = null;
      socketBrokenRef.current = true;
    }

    try {
      await recorder.startRecording({
        sampleRate: SAMPLE_RATE,
        channels: 1,
        encoding: "pcm_16bit",
        interval: STREAM_CHUNK_MS,
        onAudioStream: async (event: AudioDataEvent) => {
          if (typeof event.data !== "string") return; // float32 path, unused here
          const bytes = base64ToBytes(event.data);
          setLevel(rmsLevel(bytes));
          const socket = socketRef.current;
          if (!socket) return;
          if (socket.readyState === WS_OPEN) {
            try {
              socket.send(bytes);
            } catch {
              socketBrokenRef.current = true;
            }
          } else if (socket.readyState === WS_CONNECTING) {
            pendingRef.current.push(bytes);
          }
        },
      });
    } catch {
      // Mic never actually started (device busy, permission raced away,
      // etc.) — leave nothing running.
      closeSocket();
      setState("idle");
      setLive(false);
    }
  }, [closeSocket, recorder, settleFinalWaiters, state, transport]);

  const stop = useCallback(async () => {
    if (state !== "recording" || !transport) return;
    setState("transcribing");
    try {
      const result = await recorder.stopRecording().catch(() => null);
      const socket = socketRef.current;

      let text: string | null = null;
      if (socket && !socketBrokenRef.current && socket.readyState === WS_OPEN) {
        // Ask the bridge to commit whatever it has heard, then give it a
        // short window to send the trailing "final" before deciding the
        // stream came up empty.
        try {
          socket.send(JSON.stringify({ type: "flush" }));
          await new Promise<void>((resolve) => {
            finalWaitersRef.current.push(resolve);
            setTimeout(resolve, FINAL_WAIT_MS);
          });
          socket.send(JSON.stringify({ type: "eof" }));
        } catch {
          // Send failed mid-flush — fall through to the file below.
        }
        text = committedRef.current.trim() || null;
      }
      closeSocket();

      if (text == null) {
        // Streaming was never live, broke, or came back empty — the file
        // this same recording wrote is a complete, independent take.
        const uri = result?.fileUri;
        if (uri && transport) {
          const audio = await (await fetch(uri)).blob();
          const response = await transport.fetch("/api/voice/stt", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: audio,
          });
          const body = (await response.json()) as { text?: string };
          text = body?.text?.trim() || null;
        }
      }

      if (text) onText(text);
    } catch {
      // Silent: a failed take leaves the draft exactly as it was, which is
      // the state the user can retry from. The composer is not the place to
      // explain a provider outage.
    } finally {
      closeSocket();
      setPartial("");
      setLevel(0);
      setLive(false);
      setState("idle");
    }
  }, [closeSocket, onText, recorder, state, transport]);

  /** One button: tap to start, tap again to finish. */
  const toggle = useCallback(() => {
    if (state === "recording") void stop();
    else void start();
  }, [start, state, stop]);

  return { state, level, partial, live, toggle };
}
