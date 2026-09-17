# Maestro flows for the omg iOS client

Run them with `bun run test:e2e` from `mobile/`. The runner is
`../scripts/maestro.ts`. It resolves the simulator UDID by name, takes a lock
on the shared Mac, copies this directory over, and runs the flows there.

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
