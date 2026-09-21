# iOS artifacts — 2026-09-21

Session menus now open the server artifact index for that session. Existing image,
video, and file renderers are reused. HTML cards open a full-page interactive
viewer with reload and retry controls. The viewer fetches through the authenticated
transport and renders an opaque sandboxed frame. Web and native clients share the
HTML content policy and theme bridge in `packages/protocol/src/artifact-document.ts`.
Older native binaries show an update message instead of loading a missing module.

## Verification

- iPhone 17 Pro Max, iOS 26.5, UDID `B00EFD1F-B6DD-4C38-A0ED-47C6C04BCBB7`.
- Recorded Maestro/Jev plan: **7/7 passed** in 92.5 seconds. It verifies the
  transcript card, rendered HTML, script interaction, reload, session artifact
  list, and reopening from that list. The run uses the opt-in local demo fixture.
- Recording: `mobile/e2e/artifacts.mp4` (generated, gitignored).
- Root, web, and mobile type checks passed.
- Native suite: 39 files passed; one existing transcript harness is quarantined.
- Focused artifact checks: 5 passed. Shared web artifact checks: 9 passed.
- Dependency audit passed with no unaccepted high or critical advisories.
- Full suite: 4010 passed, 1 skipped, 15 failed. A clean worktree at the original
  `adc01bf50` commit produced 4011 passed, 1 skipped, 14 failed. Twelve failures
  matched. The three failures unique to the changed checkout were dialog/reasoning
  tests; all six checks in those files passed when run alone in both checkouts.
  The baseline also had two unrelated profile/avatar failures.

Command for the recorded build:

```bash
cd mobile
OMG_E2E_REMOTE_SRC=.omg-e2e-artifacts-84a7e1 \
EXPO_PUBLIC_OMG_DEMO=1 EXPO_PUBLIC_OMG_ARTIFACT_FIXTURE=1 \
bun run test:e2e --build --plan artifacts --record --device 'iPhone 17 Pro Max'
```

The build uses a separate Mac directory because the shared build directory was
in use. The driver reconnected once during Home setup, then all feature steps
passed. The runner released the simulator lock and stopped recording.

## Delivery

At the implementation handoff, changes were local. The user then authorized
merge and deployment. Commit `89e316704` reached `origin/main`, and the local
landing script verified the restarted service and its served bundle.

The native production build and App Store Connect submission were requested in
[mobile-release run 35597631954](https://github.com/BennyKok/omg.dev/actions/runs/35597631954),
which builds that exact commit. The workflow is the source for its final status.
No OTA or public App Store review submission was requested. HTML viewing needs
the native iOS build with `react-native-webview` 13.16.1. Existing file artifacts
keep their download/text preview behavior.


## Follow-up: all artifacts and compact agent marks

The side navigation now includes Artifacts. The same server-owned index can
show all sessions on the selected Computer or one session. All-session rows
link back to their source chat. Initial loading shows one indicator.

The compact Live Activity groups marks by canonical agent identity. Two Codex
sessions, including the `codex` and `codex-aisdk` aliases, show one Codex mark
and keep the session count at two. Expanded rows still show both sessions.

- Recorded artifact plan: **8/8 passed** in 53.0 seconds. It covers side
  navigation, artifacts from two chats, opening the source chat, HTML
  interaction, reload, the session-specific list, and reopening.
- Mobile type check passed. Native checks: 41 files passed, zero failed,
  one existing transcript harness quarantined.
- Focused artifact and Live Activity checks: 23 passed. Side-nav checks:
  six passed.
- The first run reached the all-artifacts page and source chat, then the
  driver selected the composer repeatedly. A more specific navigation goal
  passed without an app behavior change.

- Live Activity plan: **1/1 passed** in 7.6 seconds. Its accessibility label is
  `agent-codex, 2`. The screenshot confirms one mark and the count two.
  Recording: `mobile/e2e/artifact-activity.mp4`.
- The unsigned simulator build cannot start an ActivityKit push-token activity
  (`does not specify an APS environment name`). Directly signing that unsigned
  app also failed to launch. Building the same source with Xcode simulator
  signing enabled supplied the simulated entitlements and passed both plans.
- The shared Maestro MCP driver selected another simulator during the first
  supplemental Home-screen capture. The activity plan and final screenshot use
  `OMG_MAESTRO_DRIVER_PORT=7113` with the pinned Pro Max UDID.

To repeat the Live Activity check, build with both demo fixture flags above
and Xcode `CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`, install that signed
simulator app, and launch it. Use Maestro `pressKey: Home`, then run:

```bash
OMG_MAESTRO_DRIVER_PORT=7113 bun run test:e2e \
  --plan artifact-activity --record --device 'iPhone 17 Pro Max'
```

No native module, native configuration, or runtime version changed in this
follow-up. It can be delivered over the air to runtime 1.0.12. Physical-phone
activation is not part of the simulator proof.
