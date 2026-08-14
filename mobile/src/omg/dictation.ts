/**
 * Dictation: hold the mic, speak, get text in the composer.
 *
 * THE TRANSCRIPTION HAPPENS ON THE COMPUTER, not on the phone. The machine
 * already exposes `POST /api/voice/stt` (raw WAV in, `{ text }` out) behind the
 * pluggable providers in src/voice-providers.ts — the same endpoint the web
 * composer's dictation uses, with the API key server-side where it belongs.
 * Reusing it means the phone and the browser transcribe through one provider
 * and one bill, and switching provider on the machine switches both.
 *
 * The alternative was an on-device speech-recognition native module. The only
 * maintained one is still published against Expo SDK 56 while this app is on
 * 57, and it would have put a second transcription path (and a second set of
 * permissions prompts) in the product for no gain.
 *
 * WAV, 16 kHz, mono, 16-bit — not the default m4a. That is what the endpoint's
 * contract asks for and what its streaming sibling already speaks, so the
 * adapters need no format negotiation.
 */

import {
  AudioModule,
  IOSOutputFormat,
  RecordingPresets,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { useCallback, useState } from "react";

const WAV_16K: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  ios: {
    extension: ".wav",
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: 96, // AudioQuality.HIGH — the enum is a number at runtime.
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

export type DictationState = "idle" | "recording" | "transcribing";

/**
 * @param transportFetch The authenticated fetch for the selected computer —
 * `client.transport.fetch`. Passed in rather than pulled from the provider so
 * this hook stays usable from a screen that already has a client and does not
 * need a second subscription.
 */
export function useDictation(
  transportFetch: ((path: string, init?: RequestInit) => Promise<Response>) | null,
  onText: (text: string) => void,
) {
  const recorder = useAudioRecorder(WAV_16K);
  const [state, setState] = useState<DictationState>("idle");

  const start = useCallback(async () => {
    if (state !== "idle" || !transportFetch) return;
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) return;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setState("recording");
  }, [recorder, state, transportFetch]);

  const stop = useCallback(async () => {
    if (state !== "recording" || !transportFetch) return;
    setState("transcribing");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return;
      const audio = await (await fetch(uri)).blob();
      const response = await transportFetch("/api/voice/stt", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: audio,
      });
      const body = (await response.json()) as { text?: string };
      const text = body?.text?.trim();
      if (text) onText(text);
    } catch {
      // Silent: a failed take leaves the draft exactly as it was, which is the
      // state the user can retry from. The composer is not the place to
      // explain a provider outage.
    } finally {
      setState("idle");
    }
  }, [onText, recorder, state, transportFetch]);

  /** One button: tap to start, tap again to finish. */
  const toggle = useCallback(() => {
    if (state === "recording") void stop();
    else void start();
  }, [start, state, stop]);

  return { state, toggle };
}
