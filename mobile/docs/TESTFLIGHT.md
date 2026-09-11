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
| App Store | **LIVE since 2026-09-01T02:04:11Z** — version 1.0, build 37, released manually. `asc-status` now reports `Store: LIVE ... storefront us`. |
| `asc-status` store probe | Fixed 2026-09-01. It had called the iTunes lookup with no `country`, which answered `resultCount 0` for a live app three times out of three, so it printed `Store: not live` for hours after release and the review-watch bot repeated it. It now asks `us,hk,gb,jp` in order and reports the first storefront that answers. A total lookup failure reads as unknown, not as not-live. **The script lives at `~/.local/bin/asc-status` and is NOT in this repository**, so the fix is on this box only. |
| Latest TestFlight build | `1.0.2 (37)` — released to the App Store |
| EAS Update | live, branch `production`, runtimeVersion policy `appVersion`; last group `1e07dcec-cb50-4891-afab-7d0ef84d1e48` (2026-09-11, runtime `1.0.4`, `gitCommitHash a2728914a`) — see the publish log below |

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
| 2026-08-25 | `a107df18-de9b-4e07-aa80-03ee4c97888c` | `dec15833` (`#237`) | Fix sign-out hanging on the splash. `147bd274` above carried the per-account consent gate from `#232`, whose hook parks at `loading` when there is no account -- and the splash condition still tested `consent.state === "loading"` ABOVE the signed-out branch, so signing out made that condition permanently true and the sign-in screen unreachable. Guard order is now loading/fonts, signed-out, consent loading, consent needed. | Regression shipped and fixed on the same channel within the hour. Reported from TestFlight on a real device, not caught by tsc or the Metro export -- neither can see a render deadlock. Group and commit read back with `eas update:view`. |
| 2026-08-27 | `d1d4264a-a34d-4fbc-9e74-59b95089817c` | `7ce4c6d1b` | The app's screens brought up to the web's current design. Live view: rows instead of cards (flat 60pt, no fill, timestamps, live previews, folder groups whose heading is the filter), Recent section dropped, project chip collapses when unscoped, subagent spine aimed at the agent mark. Session view: attach moved inside the composer field, tool runs lose their pill, transcript spaced by speaker run. Sign-in centred. Activity rings answer a tap (this agent) and a long-press (all agents). | `git diff 35a66d3b0 7ce4c6d1b -- mobile/package.json mobile/app.json` is empty, so no native surface moved since build 37 -- which was itself built from `35a66d3b0`, the exact commit this work branched from. Published through `.github/workflows/mobile-ota.yml`; group and runtime (1.0.2, ios+android) read back with `eas update:list`. |
| 2026-09-01 | `d8591766-71bf-49da-a453-8499fb8c2191` | `a9f939a7a` (`#254`) | Bot-owned sessions no longer appear in the home list — they belong to /bots. The web dropped them in `80cb0738`/`7e5550f2`, but that filter lives at the `web/src/App.tsx` call sites, and mobile ported `session-tree.ts`/`session-groups.ts` instead, so it never came across. Also carries `2e465b892`, revealing the transcript when it settles rather than one frame in. | **First OTA to a PUBLIC App Store build, not just TestFlight.** `git diff 35a66d3b0..a9f939a7a -- mobile/package.json mobile/app.json` is empty, and `35a66d3b0` is the commit build 37 was built from, so no native surface moved. Runtime read back as `1.0.2`, ios+android, from the `Publish update` step. Verified before publishing against the live `GET /api/sessions`: 12 of 21 sessions carried `botId` and are now hidden, including `Manager`, `iOS Manager`, `Landing + Funnel Optimization` and their delegated children, which inherit the parent's `botId`. |
| 2026-09-01 | `a9823f64-3924-4a9d-897a-ea363141c7ef` | `30dc8d610` (`#258`) | The iOS ladder is two rungs: Starter Plus and Personal. Narrows `FALLBACK_TIERS` and `MOCK_CATALOG` to match `STOREKIT_PLAN_ORDER`, which was narrowed server-side in `BennyKok/vibes#1608`. Pro upgrades belong on the web; Starter is a rung the web offer has never sold. | The server change is what the phone actually reads, and it deployed first (Deploy Control Plane run 33488608007, green). This publish only stops the offline and mock paths disagreeing with it. Native surface unmoved: `git diff 35a66d3b0..origin/main -- mobile/package.json mobile/app.json` empty. Runtime read back as `1.0.2`. App Store prices for both surviving rungs were corrected the same day and take effect 2026-09-02: Starter Plus $11.99 to $21.99 (existing price preserved), Personal $57.99 to $43.99 (a decrease, so Apple offers no preservation). |
| 2026-09-06 | `abe14691-b73e-4778-ac61-590de2167a6b` | `f0408d6a3` | Native iPad workspace: persistent session list beside chat, Chat/Bots/Schedules controls, adaptive narrow windows, and reduced sidebar top spacing. iPhone keeps its existing navigation. | Native surface matches build 40 (`227020dca`): `mobile/package.json`, `mobile/app.json`, and `mobile/app.config.js` unchanged. iPad portrait/landscape, resizing, session selection, Back navigation, and iPhone checked in simulators. Mobile type check and CI export passed. Published by mobile-ota run `34013355656`; iOS/Android runtime `1.0.4`, group and commit independently read back with `eas update:view`. |
| 2026-09-07 | `c32d1129-7489-458a-924d-6f9822315f66` | `e9004131d` (`#293`) | Session composer: Return sends on a hardware keyboard (iPad) as well as the on-screen one (`submitBehavior="submit"` + `onSubmitEditing`); it inserted a newline before. Home screen: a new session runs in the folder the list is filtered to, instead of the machine default. | Native surface matches build 40 (`227020dca`): `git diff 227020dca e9004131d -- mobile/package.json mobile/app.json mobile/app.config.js` empty. Mobile type check and CI export passed. Published by mobile-ota run `34111157756`; runtime `1.0.4`, ios+android; group and commit read back from the publish step and `eas update:list`. Not checked on a device before publishing. |
| 2026-09-08 | `156832b7-6922-440c-9322-74afd2774b1d` | `f5f145e2e` (carries `da3339946`) | iPad: the rail header is the phone's header (greeting in a glass pill, user filter, computer, pages), the empty pane is a centred composer under a small wordmark, one rail gutter, New session as the first row, smaller tab strip, selected row drawn as a card, no push/pop slide. Both surfaces: Bots hidden from the rail tabs and the pages menu (routes remain), session row type 16/13, round avatars in the user filter menu. | `mobile/package.json` gained `jpeg-js` and `upng-js`, both pure JS (no `ios/`, no podspec): UIMenu ignores SwiftUI `clipShape` on a row icon, so `round-avatar.ts` renders the disc PNG in JS and writes it with `expo-file-system`'s `File` API. That module was already in build 40: the resolved version is `57.0.2` at both `227020dca` and `f5f145e2e`, and build 40's IPA (`def9a818`) ships `Frameworks/ExpoFileSystem.framework` whose binary contains `FileSystemFile`. `app.json`/`app.config.js` unchanged since build 40. Checked on iPad Pro 11 and iPhone 17 Pro simulators from a dev client before landing. Published by mobile-ota run `34184980024`; runtime `1.0.4`, ios+android; group and commit read back with `eas update:view`. |
| 2026-09-08 | `bf1a2987-f0e2-4b30-b2c0-2d41027ef260` | `21451ba7b` (`#294`) | iPad rail: the open session's row is a flat grey tint again. `156832b7` two minutes earlier had shipped it as a white card with a hairline and a shadow; this supersedes that group and otherwise carries the same code. | Native gate vs build 40 (`227020dca`): `mobile/package.json` gained `jpeg-js` and `upng-js`, both pure JS (no podspec, no `ios/` folder in the installed package). `app.json` and `app.config.js` unchanged. Mobile type check and CI export passed. Published by mobile-ota run `34185079685`; runtime `1.0.4`, ios+android; group and commit read back from the publish step and `eas update:list`. Not checked on a device before publishing. |
| 2026-09-10 | `c22216ea-72b7-4545-b17f-614fdb65a974` | `7296dbc39` | Session screen: the agent's question card (permission prompts and their answers) sits above the composer instead of underneath it. It was laid out in the normal flow between two absolutely positioned bars, so the field covered the question and most of the answer chips. | `git diff 21451ba7b 7296dbc39 -- mobile/package.json mobile/app.json` is empty; runtime `1.0.4` unchanged. Published through `mobile-ota.yml` run 34436204169; group, commit and runtime read back with `eas update:view c22216ea-72b7-4545-b17f-614fdb65a974`. |
| 2026-09-10 | `bbcbc893-f82b-491b-9634-9f8629c1df86` | `ee99fdc2f` | A displayed file is a row that opens its own page: name, type, size, caption, Download (share sheet with Save to Files), and a preview for text formats (CSV/TSV as a table). Up to 1 MB previews on open; larger files ask first and show the first 1 MB. The thinking row loses its chevron. | `git diff 7296dbc39 ee99fdc2f -- mobile/package.json mobile/app.json` is empty; `expo-file-system` was already linked (used by round-avatar.ts); runtime `1.0.4` unchanged. Published through `mobile-ota.yml` run 34449359900; group, commit and runtime read back with `eas update:view bbcbc893-f82b-491b-9634-9f8629c1df86`. |
| 2026-09-10 | `dfae63b3-cf31-4297-9889-9955a71f6793` | `1a8d76364` | Transcript: a run of thoughts and tool calls is one row, "Working for 4s" while live and "Worked for 21s" when done, opening into a sheet of every step. Home: an agent with several open findings is one row with a count that opens into them. Sending a message closes the keyboard. File page: Download is a bar icon. | `git diff ee99fdc2f 1a8d76364 -- mobile/package.json mobile/app.json` is empty; runtime `1.0.4` unchanged. Published through `mobile-ota.yml` run 34466197624; group, commit and runtime read back with `eas update:view dfae63b3-cf31-4297-9889-9955a71f6793`. |
| 2026-09-10 | `f59515d6-d13f-4801-bd84-d330310e13ea` | `489aa9563` | Live: folder pills below the header always select and filter one project; the bottom folder selector is gone. Agent, model, and thinking share one compact picker. The agent usage ring is the picker border, the composer floats at the bottom, and sessions continue behind it. Session previews on iOS and web omit tool output and fenced code. Also carries mobile parity for Auto findings, short ages, archive support, and driveable session state. | Native surface remains compatible with build 40 (`227020dca`). The only `mobile/package.json` changes are `jpeg-js` and `upng-js`, both pure JavaScript and already cleared by the 2026-09-08 OTA. `app.json` and `app.config.js` are unchanged. Mobile type check and CI export passed. Checked on the iPhone 17 Pro simulator. Published through `mobile-ota.yml` run 34498788562; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view f59515d6-d13f-4801-bd84-d330310e13ea`. |
| 2026-09-10 | `90bee8a6-f0a3-4d93-ae1d-59df77d34d69` | `5af47ce3f` | Live polish: the complete coding-agent usage icon shrinks from 38pt to 32pt while its touch target stays 38pt. The folder rail gets a little more space above it. | No native-surface change from the preceding group. Mobile type check and CI export passed. Checked on the iPhone 17 Pro simulator. Published through `mobile-ota.yml` run 34501020222; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view 90bee8a6-f0a3-4d93-ae1d-59df77d34d69`. |
| 2026-09-10 | `44485309-8bac-48ef-b993-522c9eac4766` | `502044f10` | Live chrome: the navigation divider is gone. The top bar is translucent, the folder rail stays fixed below it, and session rows scroll underneath both surfaces. | No native-surface change from the preceding group. Mobile type check and CI export passed. Top and scrolled states checked on the iPhone 17 Pro simulator. Published through `mobile-ota.yml` run 34503072777; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view 44485309-8bac-48ef-b993-522c9eac4766`. |
| 2026-09-11 | `1e07dcec-cb50-4891-afab-7d0ef84d1e48` | `a2728914a` | Live: session rows now really scroll under the top bar. The previous group had the list clipped at the bar edge by automatic content inset; the list now reserves its own top spacing and the bar is a translucent tint of the background instead of a blur, so moving rows show through it. | No native-surface change from the preceding group (`git diff 502044f10 a2728914a -- mobile/package.json mobile/app.json mobile/app.config.js` is empty); runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Top and scrolled states checked on the iPhone 17 Pro simulator in the source session. Published through `mobile-ota.yml` run 34560795408; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view 1e07dcec-cb50-4891-afab-7d0ef84d1e48`. |

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
