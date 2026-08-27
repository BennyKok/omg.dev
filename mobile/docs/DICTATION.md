# Mobile dictation: how it fails, and the trap already caught here

Written 2026-08-17 investigating Benny's live report: *"mic buttons
disconnected immediately."*

## How it works

`mobile/src/omg/dictation.ts`'s `useDictation` hook opens a websocket to
`/api/voice/stt-stream` **on whichever Computer is currently selected** —
this is not a fixed backend. That machine's `lfg serve` picks an STT
provider (`src/voice-providers.ts`) and streams partial/final transcripts
back over the socket while you talk. If the socket never opens, breaks
mid-take, or the Computer has no STT provider at all, the hook falls back
to recording a complete WAV file and POSTing it to `/api/voice/stt`
(batch) once you stop.

**Both legs depend on that Computer's own configuration**, not the
phone's. A Computer with nothing configured fails both legs silently —
until this fix (see below), with literally nothing shown to the user: no
toast, no server log line, nothing. From the outside that reads exactly
like "the mic button disconnected immediately," even though what
actually happened is closer to "recorded fine, had nowhere to send it."

## Two real bugs found and fixed here

1. **`src/voice-providers.ts`'s batch-provider fallback picked a
   guaranteed-broken provider.** `firstAvailable((c) => !!c.transcribe)`
   accepted any provider with a `transcribe` method — every provider has
   one, including the hosted `omg` relay, whose `transcribe()`
   unconditionally returns 503 (`"realtime-only; batch transcription is
   unavailable"`) by design. So on a workspace where `OMG_MEDIA_URL` is
   set *and* a real batch-capable key (ElevenLabs/OpenAI) is *also*
   configured, batch transcription still always hit the relay and 503'd —
   the working provider was never reached. Fixed with an explicit
   `batchCapable` flag per provider; `pickStt` now prefers a genuinely
   capable provider when one exists, and only falls back to the relay's
   own (accurate, specific) error when nothing else can do the job at
   all. Covered by tests in `src/voice-providers.test.ts`.
2. **Total silence on failure.** `mobile/src/omg/dictation.ts`'s `stop()`
   swallowed a definitive provider failure (the batch POST returning a
   non-2xx) with no UI signal — "silent" was a deliberate design choice
   for the *empty-take* case (you said nothing, nothing happens, correct),
   but it covered the *broken-provider* case too, which is a different
   thing and deserves a word. It now surfaces
   `useToast()`'s error banner ("Dictation isn't available on this
   computer" for a not-configured provider) in both `app/index.tsx` and
   `app/session/[id].tsx`. Server-side, `src/commands/serve.ts` now logs
   once when a stt-stream socket closes for lack of any realtime
   provider — previously that path left zero trace anywhere, which is
   exactly the gap that made this investigation start from scratch on
   Benny's own Mac (see below).

## A live example: Benny's own Mac had zero STT provider configured

Verified 2026-08-17 by reading the actual running `lfg serve` process's
environment on `bennykok@100.66.243.26` (not just its `.env` file) and its
logs — this machine, at the time of writing:

- `ELEVENLABS_API_KEY=` — empty.
- `OPENAI_API_KEY=` — empty.
- `OMG_MEDIA_URL` — unset (expected; this is not a hosted workspace).
- No `data/voice-settings.json` on disk, so it runs on hard defaults.

**If this Computer is ever selected for dictation, the take will fail
end-to-end** — no realtime provider to stream to, no batch provider to
fall back to. Post-fix that now shows "Dictation isn't available on this
computer" instead of nothing; pre-fix it was indistinguishable from a
hang.

To make dictation work on this machine: set `ELEVENLABS_API_KEY` in its
`.env` (`mobile/.../voice-providers.ts`'s `sttElevenLabs.envVar`) and
restart the service. This doc does not do that — it's Benny's own
environment and credentials.

**This was NOT where today's specific report reproduced.** The trace log
and stdout/stderr around the exact minute of the report show no
stt-stream connection at all reaching this Mac, so whatever Benny hit was
either a different (likely cloud) Computer, or failed before any network
call (e.g. a denied mic permission). Recorded here anyway because it's a
real, silent trap independent of that — and because "no trace anywhere"
on this exact machine is what cost the most time in this investigation,
which is the whole reason for fix #2 above.
