# Getting this app to TestFlight

Verified against the live account on 2026-08-12, not written from the EAS docs.

## Current state

| | |
|---|---|
| Expo account | `bennykok` / itechbenny@gmail.com — logged in on this box |
| EAS project | `@bennykok/lfg-native`, `da13049f-0ab5-411e-8c0b-e27fac475f9a` |
| Apple team | `2T82F3J732` — Chun Hung Kok (Individual) |
| Bundle identifier | `dev.lfg.mobile` — **inherited from the prototype, not yet confirmed** |
| iOS credentials | **none** — no distribution certificate, no provisioning profile |
| App Store Connect app | **none for this bundle id** (6796663211 belongs to block-yeah) |
| Builds run | none |

## The one thing blocking a build

`eas build` will not MINT iOS credentials in `--non-interactive` mode. It says:

    Distribution Certificate is not validated for non-interactive builds.
    Credentials are not set up. Run this command again in interactive mode.

Interactive mode then needs Apple account access. The fastlane session cached at
`~/.app-store/auth/itechbenny@icloud.com/cookie` **has expired**:

    › Restoring session /home/dev/.app-store/auth/itechbenny@icloud.com/cookie
    › Session expired Local session
    ? Password (for itechbenny@icloud.com):

`scripts/eas-drive.py` exists to answer eas-cli's tty prompts from an agent
session (it allocates a pty and only answers prompts it recognises, so an
unexpected question fails loudly rather than getting a blind newline). It gets
as far as the password prompt and stops there deliberately — an agent should
never be typing an Apple ID password, and repeated failed attempts risk locking
the account.

## Two ways to unblock, in order of preference

**1. App Store Connect API key (recommended, and the proper CI path).**
A `.p8` key with App Manager access, plus its Key ID and Issuer ID. This makes
both build and submit fully non-interactive, forever, with no 2FA:

    export EXPO_ASC_API_KEY_PATH=/path/AuthKey_XXXXXXXX.p8
    export EXPO_ASC_KEY_ID=XXXXXXXX
    export EXPO_ASC_ISSUER_ID=<uuid>

Create at App Store Connect → Users and Access → Integrations → App Store
Connect API. Note this is NOT the same thing as `FBPDXY9TD3` in
`~/.secrets-blockyeah` — that one is an **APNs push key** and cannot sign builds.

**2. Refresh the Apple session interactively once.** A human runs
`eas build --platform ios --profile production` and completes Apple ID +
2FA. The session then caches again and later runs are unattended until it
expires.

## After credentials exist

Building is not shipping. `eas build` produces an IPA on EAS and stops; getting
to TestFlight is a separate command against the finished build:

    eas build  --platform ios --profile production
    eas submit --platform ios --profile production --id <build-id>

`eas submit` can create the App Store Connect app record on first run, which is
the point at which the bundle identifier becomes permanent — so confirm it
before that command, not after.

`app.json` already sets `ios.infoPlist.ITSAppUsesNonExemptEncryption: false`, so
export compliance does not need answering by hand in App Store Connect on every
build.

## Sanity check that does not need Apple

`npx expo export --platform ios` bundles the whole app through Metro and fails
on anything that would break a device build (unresolved imports, bad native
module usage). It produced a 2.5 MB Hermes bundle on 2026-08-12. Run it before
spending an EAS build slot.
