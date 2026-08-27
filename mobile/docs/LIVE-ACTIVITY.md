# Live Activity — design, not built

Status: **design only**, per the Phase 2 instruction this doc came out of. Nothing here is
wired up. Written 2026-08-15 alongside the native push work in `src/omg/push.ts` and
`src/push-native.ts` on the machine — read those first; this reuses the same backend
notification-worthy events (a session running/blocked, a question waiting) rather than
inventing a third source of truth.

## The ask

A Live Activity on the lock screen / Dynamic Island showing: how many agent sessions are
running, how many are blocked and need input, and a one-line preview of one pending
question. Tapping it should behave like tapping a push notification — deep-link into the
app.

## What this needs, mechanically

A Live Activity is not a special notification. It's a small SwiftUI view driven by
**WidgetKit + ActivityKit**, and it does not run as part of the main app target — it runs
as a **Widget Extension**, a second Xcode target that ships inside the same `.ipa`. There
is no way to have a Live Activity without one; that's an ActivityKit constraint, not
something Expo chooses to make hard.

What the extension target needs:

- `NSSupportsLiveActivities = YES` in the **main app's** Info.plist (not the extension's).
- An `ActivityAttributes` struct — the static data an activity is started with (in our
  case: probably nothing, or a stable identifier) — plus a nested `ContentState: Codable`
  struct: the fields that change over the activity's life. For this feature that's the
  three things Benny asked for: running count, blocked count, one question preview
  (trimmed — content-state payloads are capped at roughly 4KB, consistent across several
  sources though I didn't pin it to one Apple doc paragraph).
- SwiftUI views for the lock-screen presentation and the three Dynamic Island states
  (compact / minimal / expanded).
- An **App Group** shared between the app target and the extension, if the app itself
  ever needs to read/write the same state (not strictly required if the activity is
  driven entirely by push).

iOS floor: Live Activities shipped in **16.1**. **Push-to-start** — starting an activity
from a server push rather than in-app code — needs **17.2**. Both are old enough now not
to be a practical constraint, but they set the floor.

## Two ways to drive it, and which one this feature needs

**Local** (`Activity.request(attributes:content:)` to start, `.update(content:)` to
push new state, `.end(...)` to close) only runs while the app can execute Swift code —
foreground, or a background task window. That's the wrong shape for this feature: the
whole point is showing fleet state while the app is closed, which is exactly when local
updates can't fire.

**Push-driven** is the actual requirement, and it's a genuinely different push type from
everything `push-native.ts` sends today:

- Header `apns-push-type: liveactivity` (today's notifications don't set this).
- **A different topic**: `<bundle-id>.push-type.liveactivity` — for us,
  `dev.omg.computer.push-type.liveactivity` — not the app's normal APNs topic. Expo's
  push relay is built around ordinary alert notifications; whether it forwards
  Live-Activity-shaped pushes with the right push-type/topic is not something I could
  confirm without either finding it explicitly documented or trying it, so treat "does
  the same Expo relay work here" as open, not assumed.
- **Push-to-start** (event: `"start"`, plus `attributes-type`, `attributes`,
  `content-state`) needs the device to have registered a **push-to-start token** — a
  distinct token from the per-activity update token, requested once (iOS 17.2+, no
  running activity required) versus the per-activity token that only exists after an
  activity has actually started.
- **Push-update** (event: `"update"`, `content-state`) needs that per-activity token,
  obtained locally via `Activity.pushTokenUpdates` after the activity starts (by local
  code or by a push-to-start).
- `event: "end"` to close it remotely (e.g. when nothing is running or blocked anymore).

So the actual data flow, if built: the machine already knows "N running, M blocked, this
question" (it's the same fleet state `session-push.ts`'s watcher already samples). It
would need to push-to-start on the first relevant state, hold the per-activity token
(another token store, alongside `push-native.ts`'s — a Live Activity token is not an Expo
push token and doesn't belong in the same file), and push-update on every fleet tick that
changes the numbers. That's meaningfully chattier than today's "notify on a settled
busy→idle edge" model — a Live Activity is closer to "keep this in sync continuously"
than "wake someone up once." Rate limiting / coalescing rapid changes would need real
thought before shipping, not assumed away.

## What Expo can and can't do here (checked 2026-08-15, some of this only as documented — not verified in this repo)

This is the part that actually decides the cost, and it moved recently:

- Expo shipped an **official but alpha** `expo-widgets` library (~SDK 55, per Expo's own
  blog) that builds both home-screen widgets and Live Activities as **React components**,
  with the config plugin generating the Widget Extension target, App Group, and
  Info.plist keys at prebuild time — and it claims push-to-start/push-update support.
  If it works as documented, this is the cheap path: no hand-written SwiftUI, mostly
  React + config plugin + EAS credentials. The catch: it's explicitly alpha ("APIs may
  change"), and there's an open, maintainer-acknowledged GitHub issue reporting widgets /
  Live Activities rendering **blank** on SDK ~55. I have not tried it against SDK 57 in
  this repo — I was told not to touch build/credentials, and this is a design doc, not a
  spike.
- The previous community option, `software-mansion-labs/expo-live-activity` (supported
  local + push, 16.2 floor), is now **archived** and its own README points at
  `expo-widgets` as the successor. Not a live option for new work.
- `EvanBacon/expo-apple-targets` (actively maintained, general-purpose "inject an Apple
  target via config plugin") is the fallback if `expo-widgets` doesn't pan out: it does
  the Xcode-surgery part (new target, entitlements, App Group) but leaves the
  ActivityAttributes/ContentState model and every SwiftUI view to be hand-written.
- Either way, **EAS Build does support building a project with an extra app-extension
  target** — this is documented (not a hard EAS limitation), gated behind
  `extra.eas.build.experimental.ios.appExtensions` in app.json, marked experimental for
  managed/CNG projects. It provisions the extension's own bundle id, entitlements, and
  credentials as part of the normal build.

**Bottom line on custom native module vs. existing plugin:** don't hand-roll a bespoke
config plugin from scratch. Start with `expo-widgets` given it's now Expo's own answer
to this exact feature — but validate it first with a disposable EAS dev-client build
before committing engineering time to the full feature, specifically checking whether
the blank-render issue reproduces on SDK 57. If it doesn't hold up, `@bacons/apple-targets`
plus hand-written Swift is the realistic fallback, not a from-scratch native module either
way — ActivityKit itself is Apple's API surface regardless of which plugin injects the
target.

## State model (for whichever path is picked)

```
ContentState:
  runningCount: Int
  blockedCount: Int
  questionPreview: String?   // trimmed; no more of the real question than a
                              // push notification already gets — see push-native.ts's
                              // redaction rationale, same argument applies here, more so:
                              // this sits on the lock screen continuously, not for the
                              // few seconds a banner is up.
  updatedAt: Date             // so a stale activity can say so rather than lie
```

Attributes (static, set once at start): nothing session-specific comes to mind — probably
just enough to identify "the omg fleet activity" if more than one activity type ever
exists.

The `questionPreview` redaction point matters more here than for a push banner: a banner
disappears; a Live Activity is pinned to the lock screen for as long as it's live. Same
"never the real text, name what it's about" call made in `push-native.ts` applies, harder.

## Cost, honestly

Not "a few days, drop in a package." Two bands depending on how `expo-widgets` alpha
actually holds up on SDK 57 — a question only a build can answer:

- **If `expo-widgets` works**: roughly a week — config plugin + React-authored widget
  views + EAS credentials/entitlements wiring + a new push-to-start/push-update sender on
  the machine reusing the fleet watcher.
- **If it doesn't** (the blank-render issue, alpha churn, or missing push support in
  practice): `@bacons/apple-targets` + hand-written SwiftUI/ActivityKit — a real native
  surface with its own Xcode build/test loop, reviewed and maintained outside the normal
  JS path — more like 1–3 weeks, plus ongoing maintenance the JS-only parts of this app
  don't have.

Either way, it needs its own EAS credentials work beyond the APNs key Phase 1 needs
(the extension's bundle id needs provisioning too), and a first spike to de-risk before
committing to a full build.
