# Native Whistle prototype

This local Expo module links the pinned Cactus Needle engine on iOS devices and
Apple Silicon simulators. CocoaPods downloads the two static libraries, checks
their SHA-256 digests, and generates an XCFramework. Generated binaries stay in
the ignored `ios/vendor/` directory. `ios/engine/needle.h` is the upstream C API.

`prepare()` downloads the pinned 16.9 MB Whistle weights to Application Support,
checks their checksum, excludes them from iCloud backup, and loads them on a
serial engine queue. The cached model works without another download.
`transcribe(uri, language)` accepts local 16 kHz mono PCM16 WAV recordings. It
handles longer recordings in consecutive 30-second blocks. Telemetry is disabled
before model loading. Audio stays on the device during native inference.

The native transcription service owns readiness and persisted mode/language.
The existing dictation hook captures its provider before microphone access.
Cloud keeps its live transcript. Local returns text after recording stops.
Auto can replay a failed local take through the existing authenticated computer
transport. If realtime replay fails, Auto retains the existing file endpoint
fallback. Forced Local and cancelled takes do not use those fallbacks.

Build verification uses `whistle-settings` in the actual app, then
`whistle-engine` with a separate audio fixture entry. The fixture runs the
production settings component, service, and native engine against public-domain
JFK audio. It does not prove physical microphone behavior, battery use, or
performance on real iPhones.

Verified on the dedicated iPhone 17 Pro iOS 26.5 simulator: nine production
Settings steps and four native audio fixture steps passed. The native fixture
returned the JFK transcript with cloud fallback disabled. Mobile type checking
and 73 native check files passed. One existing transcript-body harness remains
quarantined by the native check runner.

```sh
EXPO_PUBLIC_OMG_DEMO=1 OMG_SIM_DEVICE=omg-whistle-207954 \
OMG_E2E_REMOTE_SRC=.omg-e2e-whistle-207954 \
bun run test:e2e --build --plan whistle-settings --record

OMG_SIM_DEVICE=omg-whistle-207954 \
OMG_E2E_REMOTE_SRC=.omg-e2e-whistle-207954 \
OMG_E2E_ENTRY_FILE=scripts/whistle-engine-e2e-entry.tsx \
bun run test:e2e --build --plan whistle-engine --record
```

Run these commands from `mobile/`. Use the Mac build path. This prototype does
not submit a store build or change an existing app review.

Upstream: https://github.com/cactus-compute/needle (Apache-2.0).
Engine revision: `2ae11323dc000f5e70c49f7403efa6af12ba9e67`.
Weights revision: `b358ddadd89b7a713b5aa131f23032d3cca1b251`.
