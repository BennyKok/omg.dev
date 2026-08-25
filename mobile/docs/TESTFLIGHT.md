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
| Latest TestFlight build | `1.0.2 (29)` — submitted, Waiting for Review |
| EAS Update | live, branch `production`, runtimeVersion policy `appVersion`; last group `e82dfbf2-896d-416b-ac15-8be8cee3fdd0` (2026-08-20, `gitCommitHash ce4efa8`, `#183`) — see the publish log below |

## Publish log (`production` channel)

The channel's real history, so it's legible from the repo instead of only
`eas update:list`. Add a row here on every publish — commit hash and group id,
both independently confirmed with `eas update:view <group-id>`, not just "the
command didn't error."

| Date | Group | `gitCommitHash` | Carries | Native-compat gate |
|---|---|---|---|---|
| 2026-08-16 | `7c6c1c91` | `9367263` (`#114`) | No in-app links to an external purchase, plus the composer/session-list fixes before it | Last publish before the `expo-iap` (`#115`) native-module gap — see below |
| *(stalled ~2 days)* | | | `#115`–`#148` merged but held: `expo-iap` landed as a new native dependency and nothing had verified build 24 could take it | — this is the gap the 2026-08-18 gate procedure exists to close |
| 2026-08-18 | `b6c8a104` | `b5dcde4` (`#149`+`#150`) | List-overlap detector (diagnostic, Benny's account only), cold-load list-motion fix | Cleared: `expo-iap` confirmed guarded (`requireOptionalNativeModule`, no top-level import) and safe on build 24 despite the module being genuinely absent from that binary; `expo-linear-gradient` confirmed already compiled into build 24 pre-dating `#131`. Both verified with `strings` on the actual build-24/26 IPAs, not inferred. Full writeup: `#151`. |
| 2026-08-18 | `2ddf6471` | `276b1e2` (`#152`+`#153`) | Sign-in submit button alignment (Yoga centring fix) + "omg.dev" branding on the welcome screen; sign-out now redirects to sign-in on every signed-out path (fail-closed, after confirmed server-side revocation — see `#146`) | `mobile/package.json` and `mobile/app.json` confirmed byte-identical to the already-cleared `b5dcde4` state — no new native surface, nothing to re-verify beyond the diff itself |
| 2026-08-19 | `fcbc12a9-c7ff-43d6-bda5-8af327a26aba` | `281464e` (`#156`) | Fix to the list-overlap detector's own re-verification math (symmetric interval-overlap formula, `min(bottoms) - max(tops)`, plus the 200ms re-check) — corrects a bug that scored a relocated row as a huge fake overlap, so real-device reports from before this publish aren't trustworthy | `git diff 276b1e2 281464e -- mobile/package.json` is empty — byte-identical to the already-cleared `276b1e2` state, no new native surface |
| 2026-08-19 | `8a51c11f-2a0c-4cdf-ae89-c6ad1028702c` | `96c49da` (`#158`) | Tiebreaker diagnostics for the overlap detector — records which sections were mounting, how many rows arrived in that commit, and time since mount, so Benny's next real-device catch is decisive between the two competing theories instead of ambiguous like the last report. Instrumentation only, no behavior change. | `git diff 281464e 96c49da -- mobile/package.json` is empty — byte-identical to the already-cleared `281464e` state, no new native surface |
| 2026-08-19 | `7e0c702d-9d36-43e9-84be-ad2d41d24897` | `fc1826d` (`#160`) | Current best fix for the list-overlap bug itself — don't paint Auto/Recent until Sessions has had its turn. Simulator evidence is 18/18 clean (9 warm, 9 under simulated slow wake) versus roughly every load failing before; labelled "meaningfully fewer, not eliminated," not proven fixed. The on-device detector from `b6c8a104` stays in place to tell us whether it recurs — this bug only reproduces on Benny's physical device. | `git diff 96c49da fc1826d -- mobile/package.json` is empty — byte-identical to the already-cleared `96c49da` state, no new native surface |
| 2026-08-20 | `e82dfbf2-896d-416b-ac15-8be8cee3fdd0` | `ce4efa8` (`#183`) | Today's whole mobile queue: Bots roster (`#166`), guest side of shared Computers (`#170`), rasterized mascot avatars, and New/Edit Bot as full-page onboarding (`#182`/`#183`). Bot chat is **not** in this update — it is on an unmerged, unverified branch. | `git diff 96c49da ce4efa8 -- mobile/package.json` is empty — byte-identical to the already-cleared `96c49da` state, no new native surface |
| 2026-08-25 | `147bd274-11ee-4f57-afa3-8064410d0d13` | `4f58d0e6` (`#233`+`#234`) | Subscription labelling for guideline 2.1(b): the Settings row is now "Subscription and plan", the screen title "Subscription", the section "Monthly subscriptions", and the intro says auto-renewable. App Review could not find the In-App Purchases; nothing on the path said subscription. | First publish through `.github/workflows/mobile-ota.yml` (`#234`). `eas update` cannot run from the devbox at all -- it exports, then dies with `Failed to upload assetmap to EAS / 403 (Forbidden)`, the same GCS geo-block that forced builds into CI. `git diff 344f3be7 4f58d0e6 -- mobile/package.json mobile/app.json` is empty, so no native surface moved since build 36. Group and commit both read back with `eas update:view`. |

## Which change needs which pipeline

This is the decision that matters, and getting it wrong ships a crash.

**JS / TS / styles only → over the air.** About a minute, no Apple review:

    npx eas-cli update --channel production --environment production \
      --non-interactive --message "what changed"

`--environment` is mandatory in `--non-interactive` mode; without it the command
just errors.

Pass `--channel` on its own. Current eas-cli rejects `--channel` and `--branch`
together, and every publish in the log above was run with `--channel` alone.

**Anything native → a new build.** A new or upgraded native module, an
`app.json` change that touches the native project (name, bundle id, icon,
plugins, permissions), or an Expo SDK bump:

    npx eas-cli build --platform ios --profile production --non-interactive
    npx eas-cli submit --platform ios --profile production --id <build-id> --non-interactive

**OTA cannot deliver native code — as a rule of thumb, not a law.** Publishing
JS that imports a native module missing from the installed binary crashes on
launch — it does not degrade gracefully — UNLESS the JS side loads that module
defensively (see the `expo-iap` correction below, which is the one exception
that exists in this app today). Current native modules: `expo-updates`,
`expo-clipboard`, `expo-symbols`, `expo-haptics`, `expo-router`,
`react-native-screens`, `react-native-safe-area-context`,
`@siteed/audio-studio` (added 2026-08-15 for streaming dictation, replacing
`expo-audio` — see `mobile/docs/DICTATION.md`), `expo-linear-gradient`
(present since early builds, build 24 included — see below), `expo-iap`
(added 2026-08-16 for StoreKit, `#115`).

**`expo-iap` landing is why the OTA channel stalled at `#114` — and why, as of
2026-08-18, it doesn't have to anymore.** The last `eas update` published to
`production` before that stall was group `7c6c1c91` (2026-08-16 09:50 UTC,
`gitCommitHash 9367263` — exactly `#114`). Everything from `#115` onward was
merged but held back, on the reasoning (recorded here 2026-08-17) that
`expo-iap` made a fresh publish unsafe for any build-24 install until a build
containing the native module reached a device.

That reasoning was correct about the risk and wrong about there being no fix:
`#115` (`2ad8033`) shipped `mobile/src/omg/store.ts` in the same commit that
added the dependency, and that file loads the module through
`requireOptionalNativeModule("ExpoIap")` (from `expo-modules-core`), which
returns `null` instead of throwing when the module isn't linked into the
binary — see the comments at the top of `store.ts` for the full reasoning.
There is no top-level `import` of `expo-iap` anywhere in the app; every
caller goes through the guarded `nativeStore()` accessor and every screen
handles `isStoreAvailable() === false`. **A missing native module degrades
instead of crashing, for this one dependency, by construction.**

Verified 2026-08-18 by downloading build 24's actual IPA
(`eas build:view <build-id> --json` → `artifacts.applicationArchiveUrl`,
`unzip`, `strings -a Payload/omg.app/omg`): `ExpoIapModule` is genuinely
absent from the build-24 binary, confirming the module really isn't linked —
and group `b6c8a104` (`#149` + `#150`, JS carrying the `expo-iap` dependency
right along with it) published clean to build 24 regardless, with no crash
reports. **`expo-iap` no longer blocks OTA to build 24, or to any build.**
The general lesson: a native-module gap is a reason to make the JS side
defensive, not automatically a reason to hold every future OTA hostage to a
fresh build reaching every device.

`expo-linear-gradient` was the other suspect raised for the same publish (it
backs the `#131` composer fade, which merged after build 24 was cut) but
turned out to be a non-issue on inspection: the dependency itself has been in
`package.json` since before build 24, so autolinking compiled the native
module into build 24 whether or not any JS used it yet. Confirmed the same
way — `strings` on build 24's binary shows `LinearGradientModule` present.
The distinction that matters: a dependency present in `package.json` when a
build was cut is in that binary regardless of when app code starts importing
it; a dependency added to `package.json` after a build was cut is not, no
matter how old the feature that will eventually use it feels. Check the
dependency's own history against the build's commit, not the feature's.

`runtimeVersion` is `{"policy":"appVersion"}`, so an update only reaches builds
sharing that app version. Bumping the version in app.json deliberately cuts old
builds off rather than handing them JS their native side cannot run.

## Clearing the native-compatibility gate before an OTA publish

Do this whenever a publish will reach a build that predates it — which, under
`runtimeVersion: appVersion`, is every publish, since one runtime version
typically covers several builds at once. This took two agent sessions and
most of a day to arrive at on 2026-08-18; it should not take that long again.

1. **Map every currently-installed build to a commit.** Don't infer this from
   `CHANGELOG.md` dates or PR numbers — read it off EAS:

       npx eas-cli build:list --platform ios --json

   Pull `buildVersion`/`appVersion`/`gitCommitHash`/`distribution` for every
   build that's still on a device anywhere: internal TestFlight, external
   TestFlight, and the current App Store submission. External testers are
   usually on the OLDEST build still installed — that's the one that matters
   most, not the newest.

2. **Diff `mobile/package.json` from each installed build's commit to the
   commit being published**, one build at a time:

       git diff <build-commit> <publish-commit> -- mobile/package.json

   List every added or version-bumped dependency that ships native iOS code
   (an Expo module, anything with an `ios/` folder and a `.podspec`).
   Pure-JS additions (a `bun.lock` `overrides` pin, a JS-only utility) don't
   count.

3. **For each candidate, place it against the build cut, not the feature's
   merge date.** A dependency already in `package.json` when a build was
   compiled is autolinked into that binary regardless of whether app code
   imports it yet (`expo-linear-gradient` above). A dependency added to
   `package.json` after a build was cut is not in that binary, even if the
   code that will use it merged separately and later (`expo-iap` above,
   before the guard). Read the dependency's own git history
   (`git log -S'"the-package-name"' -- mobile/package.json`), not the PR
   that visibly uses it.

4. **When it's a real gap, verify against the binary, not the graph.**
   `package.json` says what should be linked; only the compiled binary says
   what is:

       npx eas-cli build:view <build-id> --json   # → artifacts.applicationArchiveUrl
       curl -sL <applicationArchiveUrl> -o build.ipa
       unzip build.ipa -d extracted
       strings -a extracted/Payload/*.app/<binary-name> | grep -i <ModuleName>

   Static Expo modules on iOS are usually compiled straight into the main
   app binary, not a separate `.framework` — search the main executable
   first.

5. **If a genuine gap survives all of the above, the fix is a defensive
   guard, not a delay.** Load the module through
   `requireOptionalNativeModule` (see `store.ts`) and never write a
   top-level `import` of a package that isn't in every installed binary.
   That turns "wait for every device to update" into "ship the JS now, the
   feature activates itself once the native side catches up" — which is
   what makes the next `#115`-shaped PR not cost another stalled channel.

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

**TWO LOCKFILES MEANT EAS INSTALLED THE WRONG ONE.** `mobile/` carried both
`bun.lock` and a `package-lock.json` last written 2026-08-12. `expo install`
uses bun, so it updated `bun.lock` only — and EAS built from the npm lockfile,
which still described the older dependency set. The build SUCCEEDED, shipped a
binary without `expo-image-picker`/`expo-audio` in it, and the app then died on
`Cannot find native module 'ExponentImagePicker'` at import. Nothing before
runtime says a word about it: `tsc`, `expo export` and the build itself all
pass, because locally the modules are in `node_modules`.

`package-lock.json` is deleted. If one ever reappears, delete it again rather
than keeping both in sync.

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
