# Android session crash verification

## Device evidence

The supplied Android 17 bug report contains nine omg crashes with
`ObjectAlreadyConsumedException: Map already consumed` and one Compose
`performMeasureAndLayout called during measure layout` crash.

The production R8 mapping with ID
`f9d577972444ed5bbbe05c7ac6b81481d0912e78919c3df10e0d8690144d3018`
decodes the main stack to `VirtualViewModeChangeEvent`,
`VirtualViewEventEmitter.emitModeChange`, `FabricEventDispatcher`,
`ReactVirtualView`, and `ReactScrollView.onScrollChanged`.
React Native 0.88 caches writable child maps in the mode-change event.
Repeated event-data reads consume those maps more than once.

## Change

Use ordinary transcript bodies on Android. Keep experimental `VirtualView`
on supported iOS clients. Message rows still use FlatList virtualization,
and Markdown remains memoized.

## Checks

Run from `mobile/`:

```sh
bun test ./scripts/android-transcript-body.native-check.tsx
TRANSCRIPT_TEST_PLATFORM=ios bun test ./scripts/android-transcript-body.native-check.tsx
TRANSCRIPT_TEST_PLATFORM=web bun test ./scripts/android-transcript-body.native-check.tsx
bun run typecheck
```

All 12 behavior checks and the mobile type check passed.
The tests render both real transcript boundaries with a mock native wrapper.
They check readable content, platform selection, memoization, and explicit
virtualization opt-out.

An isolated Android 16 emulator ran the patched JavaScript in a test-signed
1.0.16 (21) APK. The existing 100-message demo session used production
transcript renderers. The process stayed alive after 24 swipes and three
session reopens. The Android crash buffer stayed empty. The baseline did
not reproduce the device crash on this emulator.

No native Android build ran on the Linux server. No store submission or
production review changed. These checks preceded production publication.
The user's Android 17 device still needs a test with an updated build.
The separate Compose layout exception has not been independently reproduced
or confirmed fixed.

## Delivery gate

After rebasing onto current main, the mobile type check and all 74 active
native check files passed. One older transcript harness remains quarantined.
The 12 focused checks passed again for Android, iOS, and web.

The `mobile-ota` workflow accepts a platform input. This lets the Android
fix publish without changing iOS updates or any pending store review.
The target device uses app version 1.0.16 (21), confirmed by its bug report.
Android native dependencies and configuration match the previous 1.0.16
production OTA. The only added native dependency since that OTA is
`omg-whistle`, which declares only Apple support and loads through
`requireOptionalNativeModule`.

Use a production Android OTA for runtime 1.0.16. Verify the finished workflow,
the EAS update record, and the manifest served by the production channel.
This mobile-only change does not need a CLI version release.
