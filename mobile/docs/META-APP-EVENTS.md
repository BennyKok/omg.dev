# Meta app events (iOS)

The iOS app reports installs, sign-ups and paid plans to Meta, so Meta ad
campaigns can measure them. There is no Facebook Login.

- Code: `src/omg/meta-events.ts` (the only caller of the SDK).
- Config: `app.config.js` and `plugins/with-meta-ios.js`.
- Android: not included. `react-native.config.js` and
  `expo.autolinking.android.exclude` keep the SDK and the ad-ID library out of
  the Play build. The Play Data safety form does not change.

## Switch it on

The plugin, the tracking purpose string and `extra.meta.enabled` appear only
when the build has both variables. Without them every call is a no-op.

1. In the Meta app dashboard, copy the App ID and the Client Token
   (Settings > Advanced).
2. Add them as EAS environment variables for `production`:
   `META_APP_ID` (plain text) and `META_CLIENT_TOKEN` (sensitive).
3. In the Meta app dashboard, turn OFF "Log in-app purchases automatically".
   `meta-events.ts` logs purchases itself. With both on, each purchase counts
   twice.

## Events

| Event | When | Once per |
| --- | --- | --- |
| `fb_mobile_activate_app` | App open (SDK, automatic) | open |
| `fb_mobile_complete_registration` | Sign-in with an account under 1 hour old | account |
| `fb_mobile_purchase` | Apple charged for a plan (not a restore) | StoreKit transaction |
| `first_run_task_started` | First onboarding task started | install |

## Apple requirements (do these with the submission that adds Meta)

The tracking prompt (App Tracking Transparency) shows once, after sign-in,
when the app is active. Every feature works when the user picks "Ask App Not
to Track". The SDK reads the advertising identifier only after "Allow".
FBSDK 18 ships its own privacy manifests, so iOS blocks Meta's tracking
domains until the user allows tracking.

Checked in CI: `scripts/check-ios-purpose-strings.sh` asserts
`NSUserTrackingUsageDescription` in the generated Info.plist.

Manual, in App Store Connect, for the version that contains the SDK:

1. **App Privacy.** Answer "Yes, we use data for tracking". Mark these as
   "Used to Track You" and "Third-Party Advertising":
   - Identifiers > Device ID (the advertising identifier)
   - Purchases > Purchase History
   - Usage Data > Product Interaction
   Keep the existing App Functionality entries.
2. **App Review notes.** Add: "The App Tracking Transparency prompt appears
   immediately after sign-in on a fresh install. It is used only for Meta ad
   measurement. All features work if the user denies it."
3. **Privacy policy.** It must name Meta as a recipient of app events and the
   advertising identifier. The policy page lives in the `vibes` repository.

Guideline references: 5.1.1 (purpose strings), 5.1.2 (tracking needs ATT
permission; features must not depend on it), 2.1 (the reviewer must be able
to find the prompt).

Do not change App Privacy or the review notes while an earlier version is in
review. Make the changes together with the submission of the build that
contains Meta.
