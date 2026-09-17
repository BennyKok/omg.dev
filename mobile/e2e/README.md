# Maestro flows for the omg iOS client

Run them with `bun run test:e2e` from `mobile/`. The runner is
`../scripts/maestro.ts`. It resolves the simulator UDID by name, takes a lock
on the shared Mac, copies this directory over, and runs the flows there.

## Onboarding

```bash
bun run test:e2e --install <EAS tar.gz url or .app path> --flow onboarding
```

`onboarding/` is two flows with the runner in between: `01-request-code`
walks a fresh install to the point where auth has sent a sign-in code,
`scripts/e2e-otp.ts` reads the code from the test mailbox through the mail
MCP's Gmail library, and `02-verify` types it and asserts steps 04, 05, 06 and
home. Each run signs up a new plus-alias of `OMG_E2E_MAILBOX` (default
`itechbenny@gmail.com`) and provisions a new hosted Computer. Nothing removes
them: account deletion finishes in the browser. Expect the accounts to pile up.

It needs the `simulator-release` build, not the dev client: `launchApp` with
`clearState` is what puts every run at step 01.

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
