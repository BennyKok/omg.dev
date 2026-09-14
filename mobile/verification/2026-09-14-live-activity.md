# Live Activity and widget verification — September 14, 2026

- Source: pending changes from session `d2485a7e`, reviewed in `lfg-dfca2e`.
- Native target: iOS app runtime 1.0.8, Expo SDK 57.
- User-facing widget name: omg.dev. Existing widget kind stays OmgAgentVillage.
- Fresh prebuild: passed. AgentMarks.xcassets is in ExpoWidgetsTarget resources, not app resources.
- Native build: Xcode Debug simulator build passed with ad-hoc signing.
- Device: iPhone 16 Plus, B9BE8AE6-C5D8-42E3-901D-BF5552871AD3, iOS 26.0.
- Native views checked using fixture data: compact and expanded Live Activity, placed widget with session data, and empty timeline fallback.
- Empty timeline test: call updateTimeline([]); the placed widget shows the bundled garden, omg.dev, and the connection instruction.
- Focused checks: 70 passed, including isolated widget runtime rendering and bounded fleet status payloads.
- Root and mobile typechecks: passed.
- Full suite: 3,763 passed, 1 skipped, 11 failed. The failure names match the source session's full-suite log. No full-suite success is claimed.
- Ordinary notification icons: not implemented. The source session discussed them but did not add a notification service extension.
- Physical-device delivery and remote ActivityKit start/update/end remain unverified.

Evidence shown in the session: dfca2e-live-expanded.png and dfca2e-widget-fallback.png.
