# Browser transcription prototype

Status: local prototype. No deployment or release.

The web mic now uses one browser-owned transcription service. Its persisted
preference is independent of the computer's cloud provider configuration.

- Auto starts with the current cloud provider. It switches to Whistle only
  after the model and WASM engine have loaded successfully.
- Each take snapshots its provider, language, and fallback policy before mic
  acquisition. Downloads and settings changes affect the next take.
- Cloud always uses the existing transcription path.
- Local requires a ready model. It does not upload audio on failure.
- Auto replays a failed local take through the existing realtime broker, with
  the batch endpoint as a final recovery path on self-hosted installs.
- Chinese and Cantonese selections keep Auto on cloud. Detect mode is limited
  to Whistle's seven supported languages; it cannot reliably identify speech
  outside that set.

The shared worker downloads immutable Hugging Face revisions for the engine
and weights. Cache Storage avoids repeat downloads. Runtime initialization,
not cache presence or download progress, establishes readiness. A failed load
clears the cache so an explicit retry can recover. Cloud preference on a fresh
page does not start a download. A download already in progress may finish after
Cloud is selected, but it does not change that preference.

The prototype transcribes locally after recording stops. It does not show
local partial results. Takes longer than 30 seconds are decoded as consecutive
30-second chunks; words across boundaries can lose accuracy. The download is
16.9 MB for the model plus the separate WASM engine. Runtime memory is larger.
Safari, low-memory devices, accents, and noisy recordings need further testing.

## Try it

From `web/`, run:

```sh
bun run dev --host 127.0.0.1 --port 5297 --strictPort
```

Open `http://127.0.0.1:5297/whistle-prototype.html`. The page uses the same mic
component and settings as the app. Cloud needs the normal running API server,
proxied by Vite (default port 8766). Local does not need a cloud provider key.
Microphone capture requires localhost or HTTPS.

## Verification

```sh
bun test web/src/lib/browser-transcription.test.ts web/src/components/browser-transcription-settings.test.tsx web/src/lib/transcription-cloud-replay.test.ts web/src/lib/voice-errors.test.ts
cd web && bun x tsc --noEmit
```

Chromium verification in this worktree used the real downloaded WASM and model,
the public Whisper JFK speech fixture, and a fake WAV microphone. It verified
speech recognition, mic-to-composer delivery, Cloud preference after reload,
model readiness after a cached reload, and a live Cloud override through the
existing ElevenLabs provider. Unit tests cover cloud before
readiness, fixed provider selection, local failures, and broker replay.
