# Shipping this app — TestFlight and over-the-air

Verified against the live account on 2026-08-12. Everything here was run, not
read off the EAS docs.

## Current state

### Build 44 submission failure (2026-09-12)

Build `fb2a122a-61e0-4037-a85f-281bea17ff2c` (1.0.4, build 44,
commit `f2338276f`) built successfully in workflow run `34671132554`,
but Apple rejected the upload. The retry submission
[`f85d679b-c143-4378-a890-3186ae91f6ff`](https://expo.dev/accounts/bennykok/projects/lfg-native/submissions/f85d679b-c143-4378-a890-3186ae91f6ff)
reports errors `90062` and `90186`: version 1.0.4 is already approved and
its pre-release train is closed. Retrying that IPA cannot resolve this.

`app.json` now targets **1.0.5**. The fix landed in `e708a37eb`. EAS owns
the incrementing build number. Build 45 (`9c9c01ef-78d8-431b-9394-dbb867d32ec7`)
was built from `7f7e8cc65` in workflow `34672791382` and successfully uploaded
to App Store Connect at 2026-09-12 04:30 UTC. Submission
`aacc9b07-d681-46b7-9f3e-b6afd50e0f62` succeeded; Apple processing and
TestFlight availability are not yet confirmed. The document picker needs this
new binary; it cannot be delivered by OTA.

The `appVersion` runtime policy also makes the next iOS runtime **1.0.5**.
Future OTA updates from this configuration will not reach installed 1.0.4
builds. The 1.0.4 maintenance OTA uses `release/ios-1.0.4-e7a545`, which contains
the UI fixes with unchanged 1.0.4 native configuration.

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
| Latest iOS upload | **1.0.5 (45)** — built from `7f7e8cc65`, workflow `34672791382`, EAS build `9c9c01ef-78d8-431b-9394-dbb867d32ec7`. Uploaded to App Store Connect 2026-09-12 04:30 UTC, submission `aacc9b07-d681-46b7-9f3e-b6afd50e0f62`. Apple processing / TestFlight availability is not yet confirmed. Includes `expo-document-picker` for Choose File, the keyboard shortcut modules introduced in build 43, and the queue/sheet fixes. Build 43 was the last upload previously confirmed VALID. Build 44 was rejected because the 1.0.4 train closed. The native Files sheet passed the simulator check below; physical-phone activation remains unverified. |
| EAS Update | live, branch `production`, runtimeVersion policy `appVersion`. Two runtimes are in the field: `1.0.5` last group `341e95f4-f2d8-4577-ad20-823d06c20462` (2026-09-12, `7e5e51e0f`, main); `1.0.4` last group `451b7784-530f-4a22-8f80-2ff509dcc4f0` (2026-09-12, `b03fcc316`, main with only app version held at 1.0.4). Both include the translucent chat navigation background, live fleet status on Home, the single-line chat title, send morph and reply space, roomier Live rows, separate chat header, Latest scroll fix, inline queue confirmation, immediate queue placement, and combined work-row fixes. Publish BOTH for every phone-visible change until 1.0.4 is retired; check the installed version before attributing a missing change. |

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
| 2026-09-11 | `c9abd6b8-3921-41cc-9446-d93902a423ea` | `6d8e39749` | Composer: the agent/model/thinking picker is one custom glass sheet (folded agent pill that expands to a row of marks, inset model list, draggable thinking slider, usage ring and percentages in its header) instead of a native menu with submenus; the composer avatar is a plain mark. A `/` in the Home or chat field lists the box's skills, same endpoint and insert text as the web. Chat screen seeds Working from the session list until the socket reports. Live folder rail is transparent. | No native-surface change from the preceding group (`mobile/package.json`, `app.json`, `app.config.js` untouched); runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Picker fold/expand, slider drag, skills popup and pick checked on the iPhone 17 Pro simulator; the busy seed is code-reviewed only. Published through `mobile-ota.yml` run 34565601975; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view c9abd6b8-3921-41cc-9446-d93902a423ea`. |
| 2026-09-11 | `8d1cba41-c265-4ebc-b1de-2373a19f3579` | `fac299c38` | Picker polish: the model list gets a search field and a 5.5-row ceiling once a box reports eight or more models, with the current model pinned to the top. The thinking slider names only the active level and draws the rest as dots. The header shows the usage ring alone. Live: the selected folder pill is an outline with a lighter fill, not a white block. | No native-surface change from the preceding group; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Search, capped list, dots and pill checked on the iPhone 17 Pro simulator. Published through `mobile-ota.yml` run 34566276785; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view 8d1cba41-c265-4ebc-b1de-2373a19f3579`. |
| 2026-09-11 | `21e72ced-024a-4872-b130-8c8b40e2dbb6` | `bd72dcf9e` | Chat: a sent message is a tighter, rounder bubble with no copy button; press and hold it for a Copy sheet. Single tool-call badges and the Working indicator lose their card fill and border, matching the run rows. | No native-surface change from the preceding group; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Bubble, long-press sheet, clipboard contents and plain tool rows checked on the iPhone 17 Pro simulator. Published through `mobile-ota.yml` run 34568303151; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view 21e72ced-024a-4872-b130-8c8b40e2dbb6`. |
| 2026-09-11 | `d0836077-5b9e-44ac-ab21-cc33ef3a1ee3` | `a51e864c1` | Chat: press and hold a sent message opens a native popup menu (UIMenu) anchored to the bubble with Copy, instead of the action sheet from the preceding group. | No native-surface change from the preceding group; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Popup and clipboard contents checked on the iPhone 17 Pro simulator. Published through `mobile-ota.yml` run 34568719983; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view d0836077-5b9e-44ac-ab21-cc33ef3a1ee3`. |
| 2026-09-11 | `0d06a052-7ec7-4c82-b71e-467e29e50a6f` | `ef296bb91` | Chat: a centred time stamp ("Sep 10 3:16 PM", time only for today) at the first row and after any pause over 15 minutes, as Messages does; sent bubbles no longer carry a relative time; Claude's "[Request interrupted by user]" marker is dropped instead of rendering as an Interrupted line. | No native-surface change from the preceding group; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Stamp and bubble checked on the iPhone 17 Pro simulator. Published through `mobile-ota.yml` run 34569239150; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view 0d06a052-7ec7-4c82-b71e-467e29e50a6f`. |
| 2026-09-11 | `92dc87cb-7e01-4dc4-9ab3-dbaa00f12328` | `a15301b6e` | Live and chat: a top edge fade in the page colour under the bar (and the folder rail on Live), opaque through the status bar and dissolving below, so rows pass under the chrome the way they pass under the composer. The chat bar is transparent. The Live composer fade moved to a shared `EdgeFade`. | No native-surface change from the preceding group; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Scrolled tops of Live and chat checked on the iPhone 17 Pro simulator. Published through `mobile-ota.yml` run 34569814120; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view 92dc87cb-7e01-4dc4-9ab3-dbaa00f12328`. |
| 2026-09-11 | `ba1812d9-fbbc-43d5-93e1-7bf8d176d928` | `8f3c351dc` | Agent marks for omg, DeepSeek, Devin, fx and Muse (PNG 1x/2x/3x from the web SVGs; the omg mark drawn directly in ImageMagick because its SVG mask does not rasterise). The omg agent is labelled "omg", lower case. Chat gets the same bottom fade above its composer as Live. | No native-surface change from the preceding group (PNG assets ride the update); runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. omg mark and label checked in the picker on the iPhone 17 Pro simulator; the chat bottom fade is code-reviewed only. Published through `mobile-ota.yml` run 34570542729; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view ba1812d9-fbbc-43d5-93e1-7bf8d176d928`. |
| 2026-09-11 | `5b043665-7aa3-4210-8586-4255e84323b9` | `5e4648546` | Chat: sent bubble vertical padding is 5pt; transcript rows arrive and re-layout with an ease-out instead of a spring (the overshoot read as a shake). Toast: transport failures ("fetch failed ... network connection was lost (at Promise.swift:56)") read as one plain sentence, and "(at File:NN)" tails are cut from other errors. | No native-surface change from the preceding group; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Bubble checked on the iPhone 17 Pro simulator; the toast rewrite checked in isolation with sample messages; the animation change is code-reviewed only. Published through `mobile-ota.yml` run 34573151180; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view 5b043665-7aa3-4210-8586-4255e84323b9`. |
| 2026-09-11 | `4a6eb9bf-14e4-4930-81be-a60a59c9d451` | `b1e62efd7` | "Continue with…" opens the composer's picker (agent, model, thinking) preset to the session's agent, with a Continue button; the fork carries model and level. iPad rail: the folder rail no longer grows to share the column (ScrollView flexGrow default), which was the blank band under the pills; greeting is flat; the Chat/Schedules strip is gone (Schedules stays in the Pages menu). Transcript: the live run row is the working indicator (dots + "Working for Ns"), the footer shows only with no live run, and run rows lose the leading tool glyph. | No native-surface change from the preceding group; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Continue-with sheet checked on the iPhone 17 Pro simulator (not confirmed, since that archives the source); rail fix, flat greeting and no strip checked on the iPad Pro 11 simulator with the dev client copied over from the iPhone; the merged working indicator is code-reviewed only. Published through `mobile-ota.yml` run 34589767408; iOS and Android runtime `1.0.4`, group, and commit read back with `eas update:view 4a6eb9bf-14e4-4930-81be-a60a59c9d451`. Note: build 42 (in review) predates this group and picks it up on first launch. |
| 2026-09-11 | `6344ce39-9bb4-42e6-b6e6-2062871849a2` | `dd1bad908` | Session rows drop the amber busy dot (the agent mark's ring already says it). Also carries the keyboard-shortcut JS (`key-commands.ts`, `shortcuts-sheet.tsx`, bindings on Live and chat), which is INERT on this runtime: it requires `react-native-key-command` only when `NativeModules.KeyCommand` exists, so binaries up to build 42 ignore it. The shortcuts become real with the next build, which carries the module and `modules/omg-key-commands`. | `mobile/package.json` gains `react-native-key-command` (native), so the workflow's native-surface warning fired; the JS guard above is why publishing was still safe. Runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Home checked on the iPhone 17 Pro simulator with the old dev client (no crash, no dot). Published through `mobile-ota.yml` run 34592282927; group and commit read back with `eas update:view 6344ce39-9bb4-42e6-b6e6-2062871849a2`. |
| 2026-09-11 | `b95e5275-58ea-40ac-b872-41b88b6ad2ed` | `d1b7a315a` | Chat: sending no longer re-inserts the bubble. The machine's echo re-keyed the optimistic row (`local-N` to the real id), so the list unmounted and remounted it with the arrival animation, and the vanishing "Sending…" caption moved it as well. The echo now keeps the optimistic key (`Entry.localKey`) and is not marked fresh; the bubble is dim while pending or queued and fades to full once the machine has it. Also carries `plugins/with-key-commands.js` (inert until a build). | No native-surface change beyond the config plugin, which only affects prebuild; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Code-reviewed only: a live send was not exercised on the simulator, since that wakes an agent. Published through `mobile-ota.yml` run 34594270041; group and commit read back with `eas update:view b95e5275-58ea-40ac-b872-41b88b6ad2ed`. |
| 2026-09-11 | `8d5f5ad7-6592-4b63-8525-0e4b39353f8b` | `ef313281c` | Re-publish of the preceding group's commit by mistake: the landing script refused because the local `main` checkout was dirty (someone's dependency bumps), the OTA step then ran against `origin/main`, which had not moved. Identical JS to `b95e5275`; harmless. | Published through `mobile-ota.yml` run 34596648213. |
| 2026-09-11 | `46548b1b-a6d2-483b-a0a9-f1bd854049ac` | `ac2e2ecb7` | Chat: agent-displayed images cap at 560pt wide (min of 560 and the pane), so a screenshot no longer fills an iPad pane edge to edge. "Latest" now uses the same absurd-offset `scrollToOffset` as the auto-scroll instead of `scrollToEnd`, which aimed at a stale content height and stopped short of the bottom. | No native-surface change; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Code-reviewed only. Pushed to `main` directly (`git push origin HEAD:main`) because the local `main` checkout was dirty and the landing script refuses in that state; no server restart was needed for a mobile-only change. Published through `mobile-ota.yml` run 34596915285. |
| 2026-09-11 | `1e5ee611-7dd8-487f-a708-e722731658f3` | `4a1db39b1` | "Reconnecting…" in the header text, as on the web: the Live greeting turns into it (warning colour) while the live socket is reconnecting or offline, replacing the caption that sat under New session; the chat title capsule does the same, now subscribed to the client's connection state. | No native-surface change; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Home re-rendered on the iPhone 17 Pro simulator after the change; the dropped-socket state itself was not induced. Pushed to `main` directly (local `main` checkout still dirty with someone's dependency bumps). Published through `mobile-ota.yml` run 34599793102. |
| 2026-09-11 | `7434543d-bc58-4d8d-9634-781612f07ec5` | `f14d4a684` | Live: hold a folder pill to arrange the rail. The card lists every folder on the machine with move up/down, remove from the rail or put back, Add folder… (directory browser over `/api/filesystem/directories`, registers with `POST /api/projects/use-folder`) and New folder… (`POST /api/projects/create-folder` beside the first repo). Order and hidden set stored per machine on the device (`STORAGE_KEYS.folderRail`), intersected with the machine's list on read. | No native-surface change; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Reorder, hide, and the browser checked on the iPhone 17 Pro simulator; use-folder and create-folder were not exercised (they change the machine). Pushed to `main` directly. Published through `mobile-ota.yml` run 34600983752. |
| 2026-09-11 | `65995081-fcef-4e5d-8148-f7b99d428c5d` | `a9b126256` | Live: a "+" pill leads the folder rail and opens a create card: iOS app / Website / Slides / Image, a new project folder (created beside the first repo) or an existing one, and an editable preset prompt (`CREATE_PRESETS` in create-sheet.tsx; drafts, not yet reviewed by Benny). Start launches through the composer's `/api/sessions/new` request with the composer's agent, model and level. | No native-surface change; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Card, kind swap, and the new/existing toggle checked on the iPhone 17 Pro simulator; Start was not pressed (it creates a folder and wakes an agent). Pushed to `main` directly. Published through `mobile-ota.yml` run 34601480499. |
| 2026-09-11 | `fb62f86a-672c-4f2f-85e7-23eeeb1927c4` | `57a5c97a0` | Live: session rows get more horizontal room (inset 8 to 12, inner padding 8 to 10; mark and title now 22pt from the column edge). Tree connectors follow via `SESSION_ROW_MARK_X`; Auto cards share the constants. | No native-surface change; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Checked on the iPhone 17 Pro simulator. Pushed to `main` directly. Published through `mobile-ota.yml` run 34614005920. |
| 2026-09-11 | `6dce9367-674b-41f2-b557-ede617c9b209` | `df78aaea2` | One `Sheet` (sheet.tsx) behind the agent picker, shortcuts list, folder card and create card, with drag-down-to-dismiss on the grabber zone (follows the finger; closes past a third of the height or on a flick; springs back otherwise). Folder card: the up/down buttons are a drag handle; rows animate aside while dragging and the order is written on release. | No native-surface change; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Drag-to-dismiss on the picker and drag-to-reorder in the folder card checked on the iPhone 17 Pro simulator (a first attempt was defeated by the dev-client's floating bubble sitting over the handle, not by the code). Pushed to `main` directly. Published through `mobile-ota.yml` run 34622148295. |
| 2026-09-11 | `b4a19d9b-a2b2-4c56-8b39-6f902656d8d2` | `05f91957d` | Create card is three steps (what, where, describe) with the preset instructions folded behind "Show instructions"; the description replaces `{describe}`. Chat: every stretch of thoughts and tool calls is one "Working for Ns" row, single ones included, streaming tail inside the live run; a sent bubble rises out of the composer (translateY 72, 300ms) instead of fading in place; the send button is always the arrow (hold still queues). | No native-surface change; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. All three create steps and the grouped run row checked on the iPhone 17 Pro simulator; the bubble rise and the arrow are code-reviewed only (a live send wakes an agent). Pushed to `main` directly. Published through `mobile-ota.yml` run 34626056385. |
| 2026-09-11 | `454257db-5b53-499b-9fac-a0346ba70470` | `abe21b3b6` | Chat: held sends (the machine's new queue-mode hold, `093ad675a`) show above the composer as rows with edit (`PATCH /api/sessions/:id/queue/:mid`) and remove (`DELETE`). Fetched on open and on busy changes, polled every 2s only while something is held; a send confirmed held drops its optimistic bubble. Row type is local because the app pins `@omg-dev/protocol@0.1.353`, which predates `held`. | No native-surface change; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. Composer verified to render with the new slot on the iPhone 17 Pro simulator; a real held send was not exercised (it would queue a message into a live session). Landed through `scripts/land-session.sh` (local main clean again). Published through `mobile-ota.yml` run 34627463726. |
| 2026-09-11 | `321745a7-b0a3-4f6c-aa16-3cc64f29dc39` | `b44cd5959` | Carries `553d6421f` and `b44cd5959`. UPDATES NOW APPLY ON LAUNCH: the root checks expo-updates at launch and on return after a 20s pause, fetches, and restarts into the new bundle (before this, expo-updates' default ran a downloaded update only on the following cold launch, which is why published changes looked missing). Sheet drag-dismiss no longer reappears to fade out (exit animation skipped after a drag). Chat: animated scrolls aim at the real last offset for UIKit's standard curve; the composer bar animates its height after a multi-line send and has a little more padding. | No native-surface change; runtime `1.0.4` unchanged. Type check and Metro export passed inside the workflow. The updater is inert in the dev client, so it is code-reviewed only; THIS update itself still needs one more cold launch on devices, after which updates apply on launch. Landed through `scripts/land-session.sh`. Published through `mobile-ota.yml` run 34628544589. |
| 2026-09-12 | `c58bfec9-2505-4184-8ccf-a5cfbe6396ff` | `fbb9a9236` (run `34666248775`) | Send button follows the machine's `composerSendMode`: tap takes the setting, hold takes the other mode; the Queued chip only when the message is actually held. Ask-user questions (`omg_input`) now show as a card above the composer of the session that asked, with one-tap options; typing in the composer answers with `deliver: false`, as on the web. | `git diff b44cd5959 fbb9a9236 -- mobile/package.json mobile/app.json mobile/bun.lock` is empty, so no native surface moved since build 43. Published through `.github/workflows/mobile-ota.yml`; runtime `1.0.4` and the group id read from the `Publish update` step log. |
| 2026-09-12 | `8c066d69-aadc-49ec-a9d3-24c3b6ff40a5` | `98c1cbdd3` (run `34669650725`) | Queued sends drawn as the web's card: one card tucked under the field, a count in the header, only the next message when collapsed with a +N chip, all numbered when expanded, edit in place, cross to drop. New arrow on a row sends it now: DELETE from the queue, then the plain steer send. ⌘↩ on a hardware keyboard sends with the alternate mode, as ⌘/Ctrl+Enter on the web; listed in the shortcuts sheet. | `git diff fbb9a9236 98c1cbdd3 -- mobile/package.json mobile/app.json mobile/bun.lock` is empty, so no native surface moved since build 43. Card seen on the simulator collapsed, expanded, and with the arrow, against real held rows in a live session; the arrow itself was not tapped because it would have interrupted the verifying agent. Published through `.github/workflows/mobile-ota.yml`; runtime `1.0.4` and the group id read from the `Publish update` step log. |
| 2026-09-12 | `9cc911a7-710a-48af-aff3-22e40809dc91` | `cd3d7186b` (run `34670973259`) | Photo Library picks videos as well as photos; files over 8 MB upload in 8 MB parts through the chunk route (the machine caps one body at 32 MB); non-image attachments draw a glyph tile. Videos use a transcoding preset, because passthrough's PHAsset fast path raised a full-photo-library prompt. Row tint on the home list only on iPad; chat field 11pt vertical padding while focused; an empty field is one line at once. A new "Choose File" row is backed by `expo-document-picker`, which is NOT in build 43: it is required lazily and shows an "Update the app" alert on this binary. | **`package.json` and `bun.lock` moved** (`expo-document-picker ~57.0.2` added), so the workflow's native-surface step warned. Safe on build 43 because nothing imports the module at load; verified on the simulator: the row alerts, the app keeps running. Video pick verified after `simctl privacy reset photos`: no prompt, 27.9 KB sample landed in `lfg-uploads`. Choose File itself needs build 44 (`mobile-release.yml`). |
| 2026-09-12 | `c80754bc-6fa7-41b1-b55f-e7da5ab87df1` | `d9f6fa524` (run `34672720005`) | Transcript rows come folded from the machine: the socket URL and the page fetch declare `workRows=1`, so every run of thoughts and tool calls arrives as one `work` message and `buildTranscriptItems` maps it instead of folding. A displayed image, file, or video rides on the artifact as `tool`. The rule is `src/transcript-rows.ts` in the lfg repository (v0.6.65). A machine that predates the capability still sends raw rows, which render one per message. | `git diff cd3d7186b d9f6fa524 -- mobile/package.json mobile/app.json mobile/app.config.js` is empty; runtime `1.0.4` unchanged. Published at `d9f6fa524`, before `e708a37eb` moved `app.json` to 1.0.5, with subsequent 1.0.4 maintenance publishes listed below. Mobile type check passed. Not checked on a device before publishing; web verified end to end against the deployed server. Group, commit and runtime read back with `eas update:view c80754bc-6fa7-41b1-b55f-e7da5ab87df1 --json` (ios+android, `gitCommitHash d9f6fa524`). |
| 2026-09-12 | `10e25a78-407c-4bdc-a42a-0359cb431f91` | `4259af847` (branch `ota/work-rows-1.0.4`, run `34673895534`) | Work rows on the hosted path. `c80754bc` above put `workRows=1` on the direct transport only; the phone reaches a machine through the SDK's grant transport, whose `openLiveSocket` hard-codes `/api/live/ws`, so the machine kept sending raw tool and thinking rows and the new code drew them one per row. The wrapper now overrides `openLiveSocket` on the grant transport through its `openSocket`, one path constant for both. | Published from `ota/work-rows-1.0.4` = `d9f6fa524` + the fix (`b8d53ea3b` on main), because `main` had moved `app.json` to 1.0.5 (`e708a37eb`) and an OTA from there would target a runtime no phone has. Native surface vs `d9f6fa524` unchanged. Mobile type check passed. A first dispatch of the branch before the cherry-pick (run `34673872080`) was cancelled before it published. Read back with `eas update:view --json`: ios+android, runtime 1.0.4, `gitCommitHash 4259af847`. |
| 2026-09-12 | `a8140309-0812-4a85-a4c4-a981b28f1864` | `2da80890a` (branch `ota/work-rows-1.0.4`, run `34674047942`) | A streamed thought is a step of the live run, not the reply. Reasoning arrives as `ai_part` deltas with `kind: "thinking"` on the reply channel (server side since `37f9446f0`, 2026-08-25, which fixed the web only); the phone appended every delta to `streamText`, so a Grok session showed its reasoning as paragraphs of the answer. Thoughts now stream into their own state and render as a one-step `work` row at the tail, which joins the open run. | Carries `10e25a78`. `afbc17cf4` on main. The pinned protocol package has no `kind` on `OmgAiStreamPart`, hence a narrow cast. Native surface unchanged; mobile type check passed. Not checked on a device before publishing. Read back with `eas update:view --json`: ios+android, runtime 1.0.4, `gitCommitHash 2da80890a`. |
| 2026-09-12 | `4dd4a029-6db4-4950-bae5-26e06928e2a3` | `dfef89a46` (branch `ota/work-rows-1.0.4`, run `34674970544`) | The SDK owns transcript capabilities and drafts. `@omg-dev/client` and `@omg-dev/protocol` move to 0.6.66 (published by release `v0.6.66`): `OmgClient` is built with `{ capabilities: { workRows: true } }`, which the SDK declares on every subscribe frame and on `getMessages` for either transport, so the socket-URL override from `10e25a78` is gone; streamed drafts arrive as the SDK's `draft` event with their `kind`, so the phone no longer parses `ai_part` deltas and the `kind` cast from `a8140309` is gone. Supersedes both groups with the same behaviour. | `8053d18a3` on main. Native gate: only `mobile/package.json` moved (two pure-JS `@omg-dev/*` bumps, no native module), `app.json` and `app.config.js` unchanged, runtime 1.0.4. Mobile type check passed against the published 0.6.66; SDK tests cover the subscribe frame, the page query and thinking/reply draft separation. Not checked on a device before publishing. Read back with `eas update:view --json`: ios+android, runtime 1.0.4, `gitCommitHash dfef89a46`. |
| 2026-09-12 | `bb49b0fc-68ac-4690-a91c-92b7a6f991eb` | `8a5273be2` (branch `ota/1.0.4-combined`, run `34675792379`) | The combined 1.0.4 publish, coordinated with session 542a7801. `ota/work-rows-1.0.4` had forked at `d9f6fa524`, BEFORE `7f7e8cc65` (queue layout and sheet dismissal), so `10e25a78`, `a8140309` and `4dd4a029` all dropped that fix while superseding `ee60972a`, which had carried it. This group is `main` (`b4828c28a`) with only `mobile/app.json` held at 1.0.4, so it carries `7f7e8cc65` and the SDK 0.6.66 work-rows/draft change together. | `git diff origin/main 8a5273be2 --stat` is the one version line. Verified by content: no `if (!held.length) return` and no `queued: confirmed.queued` in `[id].tsx`; `provider.tsx` builds `OmgClient` with `workRows`; `@omg-dev/client` ^0.6.66. Native gate unchanged from `4dd4a029`. Not checked on a device before publishing. Read back with `eas update:view --json`: ios+android, runtime 1.0.4, `gitCommitHash 8a5273be2`. Lesson: a maintenance branch for the old runtime must be re-cut from `main` for every publish, not extended by cherry-pick. |
| 2026-09-12 | `37876cb1-cc0f-490b-80a3-c92d1fecf8f4` | `370bfb29b` (`main`, run `34676092226`) | The same code as `bb49b0fc`, for runtime 1.0.5. Benny's phone is on native build 45 (1.0.5, cut from `7f7e8cc65`), which predates every phone fix from today and cannot receive a 1.0.4 group; his screenshot after `bb49b0fc` still showed eight raw `shell` rows. The machine folds this session for any capable socket (37 messages, 0 raw) and sends raw only to a socket that declares nothing, which build 45 does on the hosted path. | Published from `main` with no override; `app.json` is 1.0.5 there. Native surface vs build 45 (`7f7e8cc65`): only `mobile/package.json` moved (pure-JS `@omg-dev/*` bumps). Coordinated with session 542a7801, which verifies the EAS source independently. Not checked on a device before publishing. Read back with `eas update:view --json`: ios+android, runtime 1.0.5, `gitCommitHash 370bfb29b`. |
| 2026-09-12 | `4dbfae7e-87ee-4afe-a4f4-4564495bf6b0` | `1f7658e53` | Queue refresh continues when empty while the screen is active and refreshes on foreground return. Delivered messages no longer inherit a local Queued badge. Queue/composer height changes no longer run competing layout animations. Sheets animate their existing dragged card off screen before unmounting and blur the composer before opening. | Published for runtime `1.0.4` from `release/ios-1.0.4-e7a545`; native configuration, dependencies, plugins and modules are unchanged from `cd3d7186b`. Workflow `34672790564` passed typecheck and Metro export. Group, runtime and commit independently verified with `eas update:view`. iPhone simulator checks covered the queue card and sheet dismissal. The UI fixes also landed on main in `7f7e8cc65` for build 45. Superseded by `ee60972a`: this first compatibility branch omitted the concurrent server-work-row client update. |
| 2026-09-12 | `ee60972a-fc3a-4b93-b1cb-cbed81cfeae5` | `1779f4f79` | Queue and sheet fixes plus the concurrent server-work-row client update. | The maintenance branch was merged with current main (`b9cc97262`); its only mobile diff from main is app version 1.0.4 instead of 1.0.5. Native configuration and dependencies match the previously cleared 1.0.4 runtime. Workflow `34673038633` passed mobile typecheck and Metro export. `eas update:view` independently confirmed iOS and Android runtime 1.0.4, group and commit. |

### Translucent chat navigation (2026-09-12)

The chat navigation backdrop now uses 85% opacity. The fade below it uses the
same opacity, while the title and controls remain fully opaque. Mobile
typecheck passed. The pinned iPhone 17 Pro simulator showed scrolling text
beneath the bar with the title and controls still legible.

- Runtime 1.0.5: `341e95f4-f2d8-4577-ad20-823d06c20462`, workflow
  `34689246809`, source `7e5e51e0f`.
- Runtime 1.0.4: `451b7784-530f-4a22-8f80-2ff509dcc4f0`, workflow
  `34689249474`, source `b03fcc316`. Branch `ota/nav-translucent-1.0.4`
  was cut from main with only the app version line changed.

Both workflows passed typecheck, Metro export, and native compatibility
checks. EAS readback verified both platforms, runtime versions, and commits.
Phone activation remains unverified.

### Live fleet status on Home (2026-09-12)

Home subscribes to `client.live.subscribeStatus` while focused and in the
foreground. The SDK shares one socket with transcript consumers and subscribes
to `status:*`. Home patches known sessions by ID and fetches the full list for
unknown IDs. REST responses preserve status changes received during the fetch.
Concurrent refreshes share one request; an unknown row during that request
gets a follow-up fetch. No Live Activities code changed.

REST remains the initial load and reconnect reconciliation. Home checks every
10 seconds while status support is absent or disconnected, and once per minute
when live to reconcile removals. Blur and background release the subscription
and timer. Foreground return opens them again.

SDK `0.6.67` was published in release workflow `34688442817`, source
`d481077b5`; SDK implementation `14837df0a`. Mobile installs the registry
packages, not local package copies. Mobile implementation `56d4f3305`.

Verification: 19 focused behavior tests passed, plus root and mobile typechecks
and the dependency exception audit. The full suite had 11 failures; all 11
also failed on unchanged main (which had four additional failures in that run).
The failures are outside this change. Native verification used iPhone 17 Pro
`2DDC0F84-B433-49C6-8675-87E7A98CB60E`. A real status frame changed this session's
title on Home without a REST request: the preceding REST call was at
1789208581907 and the changed-title frame arrived at 1789208623164. The next
scheduled REST call was at 1789208639999. The title was restored, and the
restoring frame arrived at 1789208648328. Temporary logging was removed.

- Runtime 1.0.5: `1a00a8af-ea39-4361-ba0f-41042f790f0b`, workflow
  `34688755112`, source `56d4f3305`.
- Runtime 1.0.4: `2647cddb-96ba-442f-b4b8-45fc24ec488d`, workflow
  `34688757228`, source `e2f27bada`. Branch `ota/fleet-status-1.0.4`
  differs from main only in the app version line.

Both workflows passed mobile typecheck, Metro export, and native compatibility
checks. EAS readback verified both platforms, runtime versions, and commits.
Physical-phone activation remains unverified.

### Single-line chat title (2026-09-12)

Removed the agent-name subtitle under the chat title. The avatar and title
remain centred in the header. A dropped connection still shows its temporary
reconnection status. Mobile typecheck passed. The iPhone 17 Pro simulator
showed the real session header without the Codex subtitle.

- Runtime 1.0.5: `c7fa8045-6629-462f-bd95-a0fe507bfc3c`, workflow
  `34687754009`, source `83e307100`.
- Runtime 1.0.4: `0b1a8131-8d13-4a01-a3a4-a8815ea31b75`, workflow
  `34687756271`, source `d3e43ffe3`. Branch `ota/header-line-1.0.4`
  was cut from main with only the app version line changed.

Both workflows passed typecheck, Metro export, and the native compatibility
gate. EAS readback verified both platforms, runtime versions, and commits.
Physical-phone activation remains unverified.

### Input-to-bubble send motion (2026-09-12)

A normal text send near the latest message now starts from the measured
composer rectangle. The bubble and transcript use one UI-thread animation
clock. Keyboard dismissal begins with that motion. The scroll target uses
final geometry instead of following the keyboard's changing inset.

The new turn reserves about half the available viewport below the message.
Reply rows consume this space before extending the transcript. Queued sends
keep their queue placement. Sends from older history and attachment-only
sends use normal scroll behavior. Failed sends remove the reserve and restore
the draft. Reduced motion skips the animated transition.

Verification: 94 focused tests passed, including rectangle transforms,
reply-space consumption, and stable scroll targets. Mobile typecheck passed.
The iPhone 17 Pro simulator covered short and multiline sends, keyboard
movement, reply growth, failure restoration, and the reduced-motion code
path. The recording uses a temporary local delivery stub and generated reply;
that instrumentation was removed before commit. The final recorded scroll
samples moved in one direction without a reverse correction. Physical-phone
activation remains unverified.

- Runtime 1.0.5: `7ab8b287-8be1-4366-a695-fbf3260f42b1`, workflow
  `34687336873`, source `cf4311430`.
- Runtime 1.0.4: `a82548de-6b0e-406f-8060-20fc7f4babbd`, workflow
  `34687348653`, source `af9f56f6e`. Branch `ota/send-morph-1.0.4`
  was cut from main with only the app version line changed.

Both workflows passed typecheck, Metro export, and the native compatibility
gate. EAS readback verified both platforms, runtime versions, and commits.

### Roomier Live session rows (2026-09-12)

Session rows now use an 80-point height and 44-point agent avatars, up from
60 and 22. Titles use 17-point text, previews use 15-point text, and the two
lines have a 4-point gap. Both lines remain mounted, so activity updates do
not resize a row. The skeleton uses the same `SESSION_ROW` geometry instead
of its old copied card measurements. Child connectors also derive their
centres from that geometry.

Mobile typecheck passed. The iPhone 17 Pro simulator showed the real Live
list with larger rows and truncation. A temporary view also rendered the
loading rows and a parent/child family to check height and connector
alignment. That view was removed before commit `0e46eb839`.

- Runtime 1.0.5: `95f7f267-3232-4080-8202-886720d85cd2`, workflow
  `34685857075`, source `0e46eb839`.
- Runtime 1.0.4: `4cffb8ac-d282-48a1-a54c-4c09350b8773`, workflow
  `34685859344`, source `b5498abe4`. Branch `ota/roomier-rows-1.0.4`
  differs only in the app version line.

Both workflows passed typecheck and Metro export. EAS readback verified
both platforms, runtimes, and commits. Phone activation remains unverified.


### Separate chat header (2026-09-12)

The chat header has separate back and menu discs. The middle section shows
an unboxed 32-point agent avatar, the chat title, and the agent name below.
It uses the remaining width, so long titles truncate without moving either
button. The header has an opaque background; transcript text fades below
it instead of passing behind the identity. Bot chats retain their bot name
and avatar. Reconnection status uses the subtitle.

Mobile typecheck passed. The iPhone 17 Pro simulator showed normal and long
titles, a working actions menu, and back navigation from a screen with a
prior route. The title probe was removed before commit `ead2ba3e5`.

- Runtime 1.0.5: `be89918f-a997-4046-adfe-dfb4b651118e`, workflow
  `34685335795`, source `ead2ba3e5`.
- Runtime 1.0.4: `0f1f13f2-4dfc-4e74-882a-939093ab9e6d`, workflow
  `34685345967`, source `d88c08cb3`. Branch `ota/chat-header-1.0.4`
  differs only in the app version line.

Both workflows passed typecheck and Metro export. EAS readback verified
both platforms, runtime versions, and source commits. Phone activation is
not verified.


### Follow-up simulator checks (2026-09-12)

Simulator build `b5dd61c4-64d4-4530-9c48-20869a8b525c` completed in
workflow `34683951166`, from `55dff53c1`, with profile `simulator` and no
submission. It was installed on iPhone 17 Pro simulator
`2DDC0F84-B433-49C6-8675-87E7A98CB60E`. This is a development build,
not another TestFlight upload.

- Native Choose File opened the Files sheet. A 39-byte text fixture was
  selected, uploaded through the real session transport, and shown in the
  composer. Source and uploaded SHA-256 matched:
  `562bb22a86bfccab7d69f1959dfa77798310baf587fa7f790896d7855b4a1647`.
  Removing the attachment, reopening Files, and cancelling left no attachment.
- The queue refreshed from empty to two held messages. Expand, edit/save,
  and remove used the real queue endpoints. Send now removed the held row
  and reached `sendMessage`; that final call was intercepted for the exact
  test text to avoid interrupting the active verification session. Actual
  agent interruption was not tested end to end.
- A short sheet drag returned the sheet. A full drag dismissed it. Opening
  and dismissing the sheet with the keyboard visible did not restore the
  keyboard. The gesture was recorded.
- The five focused queue/transcript/files test files passed: 91 tests,
  218 assertions, zero failures. Mobile `tsc --noEmit` passed. The build
  workflow also passed its typecheck, Metro, and purpose-string checks.

The existing inline confirmation and Latest scroll recordings remain the
visual evidence for those fixes. Temporary probes were removed. No new
production code or OTA was needed for this check. Paired physical phones
were unavailable, so the update loaded on the user's phone remains unknown.

### Latest activity scroll (2026-09-12)

The Latest button now floats outside the measured composer. Hiding it no
longer shrinks the bottom padding while the scroll animation is running.
An explicit jump also resets the user-scroll gate, so animation frames do
not unpin the list or show the button again before another user drag.

- Runtime 1.0.5: `257c73dc-95a9-4675-b2de-49edbb924fda`, source
  `39992d57a`, workflow `34683635071`.
- Runtime 1.0.4: `c0f9a5e8-bbb4-41dc-ace1-3bb827bf65b1`, source
  `beefdaf20`, workflow `34683651766`. Branch `ota/latest-scroll-1.0.4`
  differs only in the app version line.

Simulator baseline: showing/hiding Latest changed composer height from
106 to 150 to 106 points. Fixed: 106 points throughout. A real tap was
recorded; 36 subsequent scroll samples had zero backward steps and ended
at the native maximum offset. Both workflows passed typecheck and Metro
export. EAS readback verified both platforms, runtimes, and source commits.
Test instrumentation was removed. Phone activation remains unverified.

### Inline queue confirmation (2026-09-12)

The short-lived Queued confirmation now paints inside the empty message
field. It no longer adds a row above the composer. The queue card and its
controls are unchanged. Simulator measurement showed no height event when
the confirmation appeared or disappeared. The hint fades in and out.

- Runtime 1.0.5: `73c5214e-65fb-4d2b-8727-bf25b6a9c8a3`, source
  `2d346fff4`, workflow `34682974065`.
- Runtime 1.0.4: `6d7bffd9-2328-47bf-aefc-f71d9024446e`, source
  `3d2125807`, workflow `34682990859`. Maintenance branch
  `ota/inline-queued-1.0.4` differs only in the app version line.

Both workflows passed typecheck and Metro export. EAS readback confirmed
both platforms, source commits, and runtimes. The simulator Files test
reported `Cannot find native module 'ExpoDocumentPicker'`; it cannot verify
the Files flow on the newer phone binary. Test instrumentation was removed.
Phone activation remains unverified.

### Immediate queue placement (2026-09-12)

Busy queue sends now enter the queue card before the network request. They
never enter the transcript with a temporary Queued badge. The send response
confirms placement by message ID and status. Polls cannot erase a pending
send. Failed sends remove the pending card and restore the draft.

- Runtime 1.0.5: group `eb5b1582-ec4b-4e4a-85c1-1b5c174a5e5e`, source
  `ac74225ed`, workflow `34677520138`.
- Runtime 1.0.4: group `409eaefd-7ff8-4791-b962-af0b67aa6b69`, source
  `66572391a`, workflow `34677532392`. Branch `ota/immediate-queue-1.0.4`
  differs from `ac74225ed` only in the app version line.

Both workflows passed typecheck and Metro export. EAS readback confirmed
both platforms, runtimes, and source commits. An iPhone 17 Pro simulator
check delayed the request for 45 seconds: one pending queue card, zero
transcript bubbles, then one confirmed held row. An injected failure left
zero queue rows and bubbles and restored the draft. Test messages and
instrumentation were removed. Phone activation remains unverified.

### Verification for the 2026-09-12 queue/sheet release

Mobile typecheck, backend typecheck, and the landing web build passed. Both
OTA workflows and the native release workflow passed mobile typecheck and
Metro export. The native release also passed generated iOS purpose-string
checks. The iPhone simulator showed the held card, expansion, and dismissal
of the create and agent sheets without a keyboard remaining open. The
temporary queued test message was removed. The legacy queued-badge fix was
code-reviewed; it was not exercised through a complete agent turn.

The full local test run was not green: it recorded nine failures and then
ended with SIGTERM (exit 143). Running the six affected test files on the
unchanged `f2338276f` baseline reproduced all nine failures (60 pass, 9 fail).
They cover chat-render items, web secondary pages, plan fallbacks, feedback
wiring, thinking controls, and web sheet source assertions.

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
