# E2E for the omg iOS client: Jev plans and Maestro flows

Run with `bun run test:e2e` from `mobile/`. The runner is
`../scripts/maestro.ts`. It resolves the simulator UDID by name and takes a
lock on the shared Mac.

## Plans (the default)

```bash
bun run test:e2e --plan onboarding --record
bun run test:e2e --install <EAS tar.gz url or .app path> --plan onboarding --record
```

`<name>.plan.json` is a list of steps. Each step has a `goal` and a `done`
description in plain words; Jev (TypeSafe) reads the accessibility tree and
decides whether the step is done, whether the screen is a dead end, and what
to tap next. `expect` and `forbid` are exact strings checked in code: that is
where a feature proof lives. `selected` names a row that must report
selected (a lane, a task). `type` types text (`${EMAIL}` is substituted),
`otp: true` types the sign-in code the runner reads from Gmail, `focused: true`
skips the tap. `timeoutMs` is the ceiling per step (default 60s).

`--record` writes `<name>.mp4` here: device on the left, the step list on the
right ticking green or red as the runner decides. The raw capture is next to
it as `<name>-capture.mp4`. Both are gitignored.

Each onboarding run signs up a new plus-alias of `OMG_E2E_MAILBOX` (default
`itechbenny@gmail.com`) and provisions a new hosted Computer. Nothing removes
them: account deletion finishes in the browser. Expect the accounts to pile up.

Plans need the `simulator-release` build, not the dev client: `launchApp`
with `clearState` is what puts every run at step 01.

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
eas build --profile simulator-release --platform ios
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
