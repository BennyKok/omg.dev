# Shipping this app — TestFlight and over-the-air

Verified against the live account on 2026-08-12. Everything here was run, not
read off the EAS docs.

## Current state

| | |
|---|---|
| Expo account | `bennykok` / itechbenny@gmail.com |
| EAS project | `@bennykok/lfg-native`, `da13049f-0ab5-411e-8c0b-e27fac475f9a` |
| Apple team | `2T82F3J732` — Chun Hung Kok (Individual) |
| Bundle identifier | `dev.omg.computer` (permanent — the ASC record exists) |
| Home-screen label | `omg` (app.json `name`, baked into the binary) |
| App Store Connect app | `6800792515`, listing name `omg.dev` |
| iOS credentials | distribution certificate + provisioning profile, on EAS |
| ASC API key | `P37PJ5VSHN`, issuer `8e538491-9c7f-4ddf-88ba-4bf3e4f81fa6`, ADMIN |
| Latest TestFlight build | `1.0.0 (3)` — internal: in beta testing |
| EAS Update | live, branch `production`, runtimeVersion policy `appVersion` |

## Which change needs which pipeline

This is the decision that matters, and getting it wrong ships a crash.

**JS / TS / styles only → over the air.** About a minute, no Apple review:

    npx eas-cli update --branch production --environment production \
      --message "what changed"

`--environment` is mandatory in `--non-interactive` mode; without it the command
just errors.

**Anything native → a new build.** A new or upgraded native module, an
`app.json` change that touches the native project (name, bundle id, icon,
plugins, permissions), or an Expo SDK bump:

    npx eas-cli build --platform ios --profile production --non-interactive
    npx eas-cli submit --platform ios --profile production --id <build-id> --non-interactive

**OTA cannot deliver native code.** Publishing JS that imports a native module
missing from the installed binary crashes on launch — it does not degrade
gracefully. Current native modules: `expo-updates`, `expo-clipboard`,
`expo-symbols`, `expo-haptics`, `expo-router`, `react-native-screens`,
`react-native-safe-area-context`.

`runtimeVersion` is `{"policy":"appVersion"}`, so an update only reaches builds
sharing that app version. Bumping the version in app.json deliberately cuts old
builds off rather than handing them JS their native side cannot run.

## Traps that have already cost time here

**Building is not shipping.** `eas build` stops at an IPA on EAS servers. Only
`eas submit` reaches App Store Connect. `build:list` says `finished` for a build
that never went anywhere.

**Submitting is not TestFlight either.** Apple processes the upload afterwards.
On 2026-08-12 `submit:list` read `finished` at 15:49 while TestFlight still
reported `No builds found`; the build appeared at 15:52. Verify with:

    npx eas-cli submit:status --platform ios --non-interactive

**`--auto-submit` fails AFTER the build in non-interactive mode** unless
`ascAppId` is set in the submit profile — it cannot resolve which App Store
Connect app to target and only says so at the end. Now pinned in `eas.json`.

**A transitively-available native module still breaks the build.** `expo-symbols`
resolved through `expo-router`, so it typechecked and bundled locally while
being absent from `package.json`. EAS installs fresh. Always `npx expo install`
the thing you import.

**Cheap check before spending a build slot:**

    npx tsc --noEmit
    npx expo export --platform ios

The export runs the whole app through Metro and fails on anything that would
break a device build. It has caught real breakage here.

## Credentials

Both certificate and profile now live on EAS, so builds run unattended. If a
NEW bundle identifier is ever introduced, EAS will refuse to mint credentials in
`--non-interactive` mode ("Credentials are not set up. Run this command again in
interactive mode") and a human has to do one interactive `eas build` with an
Apple ID, password and 2FA. The ADMIN ASC API key covers submission but not
certificate creation.

`scripts/eas-drive.py` can answer eas-cli's menu prompts from an agent session.
It refuses to type anything while a credential prompt is on screen — on
2026-08-12 an earlier version typed a stray token into an Apple ID field and
submitted a bad login. Do not loosen that guard.
