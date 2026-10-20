# E2E for the omg iOS client: Jev plans and Maestro flows

Run with `bun run test:e2e` from `mobile/`. The runner is
`../scripts/maestro.ts`. It resolves the simulator UDID by name and takes a
lock on the shared Mac.

## Plans (the default)

```bash
bun run test:e2e --plan onboarding --record
bun run test:e2e --build --plan onboarding --record
bun run test:e2e --install <EAS tar.gz url or .app path> --plan onboarding --record
```

`<name>.plan.json` is a list of steps. Each step has a `goal` and a `done`
description in plain words; Jev (TypeSafe) reads the accessibility tree and
decides whether the step is done, whether the screen is a dead end, and what
to tap next. `expect` and `forbid` are exact strings checked in code: that is
where a feature proof lives. `selected` names a row that must report
selected (a lane, a task). `type` types text (`${EMAIL}` is substituted),
`observeOnly: true` prevents suggested taps and typing after explicit setup
gestures. Use it for idle checks.
`otp: true` types the sign-in code the runner reads from Gmail, `focused: true`
skips the tap. `timeoutMs` is the ceiling per step (default 60s).

`--record` writes `<name>.mp4` here: device on the left, the step list on the
right ticking green or red as the runner decides. The raw capture is next to
it as `<name>-capture.mp4`. Both are gitignored.

The session folder move plan uses the full app with local demo data:

```bash
EXPO_PUBLIC_OMG_DEMO=1 OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx \
  OMG_MAESTRO_DRIVER_PORT=7179 \
  bun run test:e2e --build --plan session-move --record
```

Use an unused driver port. The plan checks both move directions and retained
chat history. It does not contact an agent provider. The runtime restart and
rollback checks are in `src/session-move.test.ts` at the repository root.

The linked app plan uses the same demo data. Its `api-gateway` project links
to a demo app, and the plan opens the session menu and the app submenu:

```bash
EXPO_PUBLIC_OMG_DEMO=1 OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx \
  OMG_MAESTRO_DRIVER_PORT=7179 \
  bun run test:e2e --build --plan linked-app --record
```

The scroll-follow plan checks that a working session's transcript holds
still at the bottom when no message arrives. It reproduces the 2026-10-16
iPhone report: the list jumped about 470pt up and glided back every second or
two, and the "Latest" pill flashed during each glide.

```bash
EXPO_PUBLIC_OMG_DEMO=1 EXPO_PUBLIC_OMG_FOLLOW_FIXTURE=1 \
  OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx \
  OMG_SIM_DEVICE="iPhone Air" OMG_MAESTRO_DRIVER_PORT=7191 \
  bun run test:e2e --build --plan scroll-follow --record
```

The fixture seeds a busy session shaped like the reported one
(`followMessages` in `src/omg/demo-data.ts`). It also turns on the follow
probe (`src/omg/follow-probe.ts`). The probe draws a line over the transcript
and counts each upward jump and each "Latest" flash that happens without a
finger on the list, for 20 seconds after the last drag. The plan expects
"Follow check passed". The detector itself is covered by
`scripts/follow-probe.native-check.ts`.

The history-hold plan checks that loading older messages keeps the reader's
place. It reproduces the 2026-10-16 report: at the top of a loaded page, iOS
anchored the position to the page's first time stamp, an older page removed
that row, and the list moved.

```bash
EXPO_PUBLIC_OMG_DEMO=1 EXPO_PUBLIC_OMG_PERFORMANCE_FIXTURE=1 \
  EXPO_PUBLIC_OMG_HISTORY_DELAY_MS=6000 EXPO_PUBLIC_OMG_SCROLL_PROBE=1 \
  OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx \
  OMG_SIM_DEVICE="iPhone Air" OMG_MAESTRO_DRIVER_PORT=7191 \
  bun run test:e2e --build --plan history-hold --record
```

The 6 s page delay makes each older page land after the swipe has come to
rest. The reading probe (`src/omg/read-probe.ts`) picks the first row on
screen when the list stops, and measures it every 100 ms. A move of more than
40pt that lasts, or a lost row, fails the check. A move that the next sample
undoes is reported as a flicker and does not fail, because one sample cannot
tell a one-frame flash from a measurement taken mid-update. Check the video
for those. The last step requires a second page and "0 failed loads". Without
the fix the third step fails with "1 lost rows".

The long-chat flow measures the real session screen on a large chat. With
`EXPO_PUBLIC_OMG_HISTORY_ROWS=1200`, the performance fixture serves 1,200 rows
shaped like a working session (`largeHistory` in `src/omg/demo-data.ts`). The
flow flicks up 40 times through the older pages and then down 10 times.

```bash
EXPO_PUBLIC_OMG_DEMO=1 EXPO_PUBLIC_OMG_PERFORMANCE_FIXTURE=1 \
  EXPO_PUBLIC_OMG_HISTORY_ROWS=1200 EXPO_PUBLIC_OMG_SCROLL_PROBE=1 \
  OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx \
  OMG_SIM_DEVICE="iPhone Air" OMG_MAESTRO_DRIVER_PORT=7191 \
  bun run test:e2e --build --flow long-chat-perf
bun run test:e2e --inspect | grep -o "Perf [^\"]*"
```

The perf probe (`src/omg/perf-probe.ts`) counts UI-thread and JS-thread
frames only while the list moves. It also reports the open time, mounted and
loaded rows, the worst JS frame after the content grew, and how often the
screen rendered. Read the probe again after a minute with no input: the render
count must not grow while the chat is idle. Simulator frame counts follow the
Mac's load, so alternate builds in one sitting, and trust render counts over
frame counts.

To reproduce a layout bug with real traffic, a probe build can read a real
`lfg serve` instead of the demo data. Sign-in stays fake. Set
`EXPO_PUBLIC_OMG_DEMO_BOX_PORT` at build time and reverse-forward the box to
the Mac's localhost, which App Transport Security allows:

```bash
ssh -N -R 127.0.0.1:18766:127.0.0.1:8766 bennykok@bennys-macbook-pro-2 &
EXPO_PUBLIC_OMG_DEMO=1 EXPO_PUBLIC_OMG_SCROLL_PROBE=1 EXPO_PUBLIC_OMG_DEMO_BOX_PORT=18766 \
  OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx bun scripts/e2e-build.ts
```

The forward exposes the box's API on the Mac's localhost. Stop it when the
run ends. Never set the port in a build that ships.

Each onboarding run signs up a new plus-alias of `OMG_E2E_MAILBOX` (default
`itechbenny@gmail.com`) and provisions a new hosted Computer. Nothing removes
them: account deletion finishes in the browser. Expect the accounts to pile up.

Those addresses are on the auth service's trusted-sender list
(`vibes/apps/auth/src/trusted-senders.ts`), so repeated runs from the one
Mac are not blocked by the per-IP limit or the Turnstile check. The only cap
is 30 codes an hour and 200 a day across all runs. Change the address shape,
and you must change that list too.

Plans need a release build, not the dev client: `launchApp` with `clearState`
is what puts every run at step 01. `--build` makes one with Xcode on the Mac
(`scripts/e2e-build.ts`), about 45 seconds when the native project is warm.
`eas build --profile simulator-release --platform ios` produces the same thing
in about ten minutes and is the fallback.

## The App Review plan

```bash
OMG_E2E_EMAIL=appreview@omg.dev OMG_REVIEW_CODE=<code> \
  bun run test:e2e --plan reviewer --record
```

`reviewer.plan.json` walks what App Review walks: Welcome, the sign-in
drawer, the demo account, its FIXED code, the data notice, and the
signed-in session list. `OMG_REVIEW_CODE` short-circuits the Gmail read,
because that code never arrives by mail. The code lives in App Store Connect
and in the environment. It is NOT in this repository, which is public.

The last step exists for one regression: on 2026-09-17 the list rendered
empty while the demo box held real sessions, which reads as a broken app.
`forbid: ["No sessions yet"]` fails by name if that returns.

Run it before every submission, and re-read
`docs/ASC-LISTING-READINESS.md` for the state of the demo Computer.

## Static flows

`--flow NAME` runs `NAME.yaml` with `maestro test`; `--flow onboarding` runs
the two-half YAML version in `onboarding/` (kept as the fallback when Jev is
unreachable). New proofs are plans, not flows.

### Rate of runs

Auth challenges the fourth code send from one IP inside an hour
(`apps/auth/src/signin-risk.ts` in vibes, `IP_BURST_SENDS`). The app sends a
browser `Origin` and has no Turnstile, so the send fails with "Please confirm
you are a person, then try again." and the flow stops there by name. Three
onboarding runs per hour per Mac, including any manual sign-ins from that
Mac, is the ceiling.

## Do not put `launchApp` in a flow yet

The simulator carries a **development build**. `launchApp` restarts the app
with no Metro attached, and the app lands on the Expo dev-client launcher
("Searching for development servers...") instead of your UI. Every later
assertion then fails for a reason that has nothing to do with your change.

These flows therefore assume the app is already loaded. That is fine locally
and useless in CI.

`launchApp` becomes safe once a standalone build with the bundle embedded is
installed on the device:

```bash
bun run test:e2e --build          # Xcode on the Mac, about 45s warm
eas build --profile simulator-release --platform ios   # the fallback, about 10 min
```

Add `launchApp` at that point, not before.

## Selectors

Read the screen with `bun run test:e2e --inspect` and copy strings verbatim.

- Use `text:`. Maestro's `text:` matcher is **full-string regex, IGNORE_CASE**,
  so a partial string does NOT match. Anchor with `.*` if you need a prefix.
- iOS `accessibilityText` maps to `text:`. Never write `accessibilityText:` or
  `a11y:` as a selector key. Maestro does not accept them.
- Prefer `id:` where the element has a stable `resource-id`. Most of this app
  does not yet. Add `testID` props as you touch screens.

## Managed model picker

The `managed-models` plan uses the production `AgentSetupSheet` in a simulator
screen. It reads the connected Computer's live model catalog and prices.
It verifies grouping, scrolling, search, model selection, and return to the
default model. It does not test account sign-in.

Forward the local Computer API to the Mac's loopback address while testing:

```bash
ssh -N -R 127.0.0.1:18766:127.0.0.1:8766 bennykok@bennys-macbook-pro-2
```

In another terminal, from `mobile/`:

```bash
OMG_E2E_ENTRY_FILE=scripts/managed-models-e2e-entry.tsx \
  bun run test:e2e --build --plan managed-models --record
```

Stop the forward after the check. The test screen is included only when the
explicit `OMG_E2E_ENTRY_FILE` override is set. Normal app builds use the Expo
Router entrypoint.

Schedule loading regression (200 daily, weekly, monthly, annual, and
impossible schedules through the demo transport):

```bash
EXPO_PUBLIC_OMG_DEMO=1 EXPO_PUBLIC_OMG_SCHEDULE_LOAD_FIXTURE=1 \
  OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx \
  bun run test:e2e --build --plan schedule-loading --record
```

This tests the real native screen with synthetic schedules. It does not
measure the hosted API or relay.

The idle-transcript plan checks formatted production message rows during
periodic parent updates. It holds still for 20 seconds, rejects height changes
after the initial layout, and then scrolls through lists, code, and tables:

```bash
OMG_E2E_ENTRY_FILE=scripts/idle-transcript-e2e-entry.tsx \
  bun run test:e2e --build --plan idle-transcript --record
```

This is a renderer fixture, not a live conversation. Run `scroll-follow` as
well for the full session screen. The fixture detects layout changes, not
every possible text-paint defect; inspect the recording too.


The keyboard-scroll plan checks the full session screen with a long reply
below a portrait video tile. It types an unsent draft, scrolls back and returns
to the latest reply, then watches for 20 seconds with the keyboard open. It
also opens the reply action sheet, selects and copies text, and checks the
draft after returning to chat.

```bash
EXPO_PUBLIC_OMG_DEMO=1 EXPO_PUBLIC_OMG_FOLLOW_FIXTURE=1 \
  EXPO_PUBLIC_OMG_KEYBOARD_FIXTURE=1 \
  OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx \
  bun run test:e2e --build --plan keyboard-scroll --record
```

This uses local fixture data and the production screen. The follow probe
checks scroll jumps and Latest flashes. The history-load probe is disabled
for this fixture because no history loads during the watch and the final
reply starts above the exposed viewport. Use history-hold for page insertion.
