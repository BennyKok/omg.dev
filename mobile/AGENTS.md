# LOOK AT THE APP. There is a real simulator, over Tailscale.

A UI change is not verified until you have SEEN it. `tsc --noEmit` and
`expo export` both pass on a layout that renders as an unreadable grey screen —
that happened on 2026-08-14, and a broken nav bar was committed and pushed on
the strength of those two green checks. Neither one can see a screen.

**If you touch an iOS feature, prove it with `bun run test:e2e --plan <name>
--record` and add a step for what you changed.** Maestro drives the real
simulator, Jev judges each step from the accessibility tree, and the run ends
with the side-by-side step video. It is the only check here that can see a
screen. See "Prove it with Maestro and Jev" below.

The Mac is a Tailscale peer, so it is reachable from any dev box on the tailnet
with no port forwarding and no VPN setup:

```bash
# The Mac. Use the MagicDNS name, not the 100.x IP — the IP can change.
ssh bennykok@bennys-macbook-pro-2 'xcrun simctl list devices booted'
```

## `booted` IS A COIN FLIP WHEN TWO DEVICES ARE UP. PIN THE UDID.

Every `simctl` example below says `booted`, and that word resolves to *a*
booted device, not *the* one you mean. More than one simulator is routinely
up on this Mac — agents work in parallel and each leaves its device running —
and then `booted` silently picks one.

**The failure mode is silent and it does not look like a device mix-up.** On
2026-08-16 one agent screenshotted with bare `booted`, computed tap
coordinates from that image, and the taps did nothing. It re-derived the
window origin (unchanged), concluded its calibration was fine, and gave up —
it had been reading one device and clicking the other. A second agent hit the
same ambiguity from the other side: `get_app_container booted dev.omg.computer`
answered for the Pro Max while it was reasoning about the Pro. Both commands
succeed. Both return real, plausible output. They just refer to different
screens.

So resolve the UDID once and pass it explicitly to every command:

```bash
# Pick the device by NAME, then use its UDID everywhere. Never bare `booted`.
PRO=$(ssh bennykok@bennys-macbook-pro-2 \
  "xcrun simctl list devices booted | awk '/iPhone 17 Pro \(/{print \$NF}'" | tr -d '()')
ssh bennykok@bennys-macbook-pro-2 "xcrun simctl io $PRO screenshot /tmp/s.png"
```

Cheap independent check: the screenshot's pixel dimensions identify the model.
iPhone 17 Pro is **1206x2622**, 17 Pro Max is **1320x2868**. If you are unsure
which device you just captured, measure it rather than assume.

**The device is shared.** Before you point it at your tunnel, check whether
another Metro/tunnel is live (`ss -lntp | grep 809`, and the ngrok APIs below);
say so when you take it, and hand it back when you are done. Re-pointing a
device someone else is mid-run on makes them screenshot *your* build.

Full loop — Metro here, simulator there:

```bash
# 1. Metro needs --tunnel: the Mac cannot reach this box's localhost.
#    PICK AN UNUSED PORT — 8081 is the default and is usually already taken by
#    another agent's worktree. Check first: ss -lntp | grep 80
cd mobile && npx expo start --tunnel --port 8095 > /tmp/metro8095.log 2>&1 &

# 2. Get the tunnel URL (it is NOT printed to the log).
#    NOT necessarily :4040 — that is ngrok's api port for the FIRST tunnel on
#    the box, and every later one takes 4041, 4042, ... Scan, and match on your
#    own port number rather than taking tunnels[0] blindly.
for p in 4040 4041 4042 4043; do
  curl -s --max-time 3 localhost:$p/api/tunnels \
    | python3 -c "import json,sys;[print(t['public_url']) for t in json.load(sys.stdin)['tunnels']]" 2>/dev/null
done | grep -m1 '^https.*-8095\.'

# 3. Point the dev client at it. The scheme is `omg` (app.json -> expo.scheme),
#    NOT `omgdev` — the bundle id is dev.omg.computer and confusing the two
#    gives a useless `OSStatus error -10814`. URL-ENCODE the tunnel url.
#    Terminate the app first or the dev client refuses with "Current Endpoint".
ssh bennykok@bennys-macbook-pro-2 "xcrun simctl terminate $PRO dev.omg.computer;
  xcrun simctl openurl $PRO 'omg://expo-development-client/?url=<TUNNEL_URL_ENCODED>'"

# 4. Wait for `iOS Bundled` in the log, then LOOK.
ssh bennykok@bennys-macbook-pro-2 "xcrun simctl io $PRO screenshot /tmp/s.png"
scp bennykok@bennys-macbook-pro-2:/tmp/s.png /tmp/s.png
```

## When `--tunnel` will not come up, reverse-forward to the Mac's localhost

On 2026-08-31 `npx expo start --tunnel` failed outright, repeatedly:
`CommandError: TypeError: Cannot read properties of undefined (reading 'body')`
pointing at the ngrok status page. There is a way through that does not
involve ngrok at all.

**Do not simply serve over the tailnet IP.** Both boxes are Tailscale peers
and the Mac can reach this one (`curl http://100.x.x.x:8095/status` returns
200), but the dev client cannot load from it: iOS App Transport Security
rejects cleartext HTTP to a plain IP, and the failure is only visible in the
device log, not on the error screen the app shows you.

```
Error Domain=NSURLErrorDomain Code=-1022 "The resource could not be loaded
because the App Transport Security policy requires the use of a secure
connection." NSErrorFailingURLStringKey=http://100.91.73.65:8095/
```

`localhost` IS exempt from that policy, so give the Mac a localhost. Run
Metro normally and reverse-forward the port over SSH:

```bash
# Advertise localhost in the manifest, or the bundle loads and then the
# RUNTIME reconnects to the tailnet IP and dies on the same ATS rule.
REACT_NATIVE_PACKAGER_HOSTNAME=localhost npx expo start --port 8095 &
ssh -N -R 8095:localhost:8095 bennykok@bennys-macbook-pro-2 &
xcrun simctl openurl "$PRO" 'omg://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8095'
```

The first bundle over this link took 158s for 10MB at ~240ms RTT; every
reload after that was under 3s. Fetching the bundle URL once from the Mac
with `curl` before opening the app warms Metro and avoids the dev client
timing out on its first try.

To read a load failure the error screen truncates:

```bash
xcrun simctl spawn "$PRO" log show --last 3m --style compact \
  --predicate 'processImagePath CONTAINS "omg"' | grep -iE 'fail|error'
```

## Prove it with Maestro and Jev. Do not synthesise clicks.

Any session that touches an iOS feature runs this. It is the layer that `tsc`,
`test:native` and `expo export` structurally cannot cover, and it is the layer
that shipped a grey screen and a broken nav bar.

```bash
cd mobile
bun run test:e2e --plan onboarding --record          # THE proof: Jev-judged plan + step video
bun run test:e2e --build --plan onboarding --record   # build the app on the Mac first, then prove it
bun run test:e2e --install URL --plan onboarding --record   # same, on an EAS simulator-release artifact
bun run test:e2e --inspect                           # print the current screen's elements
bun run test:e2e --flow smoke --record               # a static Maestro flow, maestro record --local
```

The runner is `scripts/maestro.ts`. It resolves the UDID **by device name**,
takes an exclusive lock on the shared Mac, and releases it in a `finally`.

**Every feature change is proven by a `--plan` run with a step for the change,
and the video goes with the ship.** Benny's rule, 2026-09-17, made the default
on 2026-09-18. A hand-driven tap session is not proof. For onboarding that
means `--plan onboarding --record` on a release build that contains the
change. Use `--build`: Xcode on the Mac, about 45 seconds once the native
project is warm, against about ten minutes plus a queue for
`eas build --profile simulator-release --platform ios`. Add the step, or the
`expect` strings, in the same commit as the change.

### `--build`: the app comes from the Mac, not from EAS

`scripts/e2e-build.ts` rsyncs `mobile/` and `packages/protocol/src` to
`~/.omg-e2e-src` on the Mac, runs `bun install`, and builds with
`xcodebuild -sdk iphonesimulator -configuration Release`. The result is the
same product as the `simulator-release` profile: unsigned, bundle embedded, no
dev client to pop over the app. `maestro.ts --build` installs it and runs the
plan.

- It builds BEFORE it takes the device lock. A build touches no simulator.
- The native project (`ios/`) and DerivedData stay between runs. That is the
  whole speed: the first build is minutes, later ones are the bundle phase.
  `expo prebuild` runs only when `ios/` is absent, because it rewrites the
  project and throws DerivedData away.
- Do NOT use `expo run:ios --device <udid>`. It reads a simulator UDID as a
  physical device and stops on "No code signing certificates are available".
- The Mac needs node >= 20.19.4 for Expo. `~/.bun/bin/node` is bun's shim and
  shadows the real one, so the script puts the highest `~/.nvm` version in
  front of `PATH` itself.
- EAS stays the path for TestFlight and for a machine that cannot reach the
  Mac.

### Plans, not flows: how the Jev runner works

A plan (`e2e/<name>.plan.json`) is a list of steps, each with a `goal` and a
`done` description in plain words, plus optional `expect` / `forbid` strings.
`scripts/e2e-jev.ts` runs it:

1. One `maestro mcp` process for the whole run (`scripts/maestro-mcp.ts`), so
   there is no JVM restart per tap.
2. For every look: `inspect_screen` (the accessibility tree, text only), one
   Jev call (`scripts/jev.ts`, about half a second) with three questions:
   `done`, `blocked`, `tap`.
3. `done` high and every `expect` string present and every `forbid` string
   absent: the step passes, immediately. No fixed waits anywhere.
4. `blocked` high (error, rate-limit challenge, dev menu): the run fails NOW,
   by name, instead of sitting out a 120 second timeout.
5. Otherwise it taps what Jev picked and looks again.

Exact facts stay in code. A feature proof is the `expect` list: the strings the
screen must show. Jev only decides readiness and navigation, the part a fixed
selector cannot survive a copy change on. Never put the proof in the `done`
prose alone.

`--record` captures the device with `simctl` and composes the Maestro-style
video with ffmpeg on this box: device on the left, the step list ticking on
the right at the moment the runner decided. It lands at `e2e/<name>.mp4`,
which is gitignored. Attach it with `omg_display_video`.

Jev needs `TYPESAFE_API_KEY` or `~/.config/typesafe/env`. It takes text only,
no screenshots; that is why the tree is the state. Static YAML flows in
`e2e/*.yaml` still run with `--flow` and are fine for a fixed smoke, but new
proofs are plans.

### Why this replaces the CGEvent section below

Maestro talks to the device by UDID through its own on-device driver, and
matches elements from the accessibility tree. That deletes every trap the old
approach documented, because none of the machinery is involved any more:

| Old trap | Why it is gone |
| --- | --- |
| bare `booted` picks another agent's device | the runner pins the UDID by name |
| stale `AXRaise`, tap lands on a non-key window | no window focus, no coordinates |
| `keystroke` silently no-ops over SSH | `inputText` goes through the driver |

A selector that does not match is a loud failure with a screenshot, instead of
a tap into empty space that looks like a pass.

### Writing selectors

Read the screen with `--inspect` and copy the strings verbatim. Never author a
selector from a screenshot: an element showing a heart icon looks like a
"Favorite" button in an image and has no such text in the hierarchy.

- `text:` is **full-string regex, IGNORE_CASE**. A partial string does NOT
  match. Anchor with `.*` for a prefix.
- iOS `accessibilityText` maps to `text:`. `accessibilityText:` and `a11y:`
  are not selector keys and Maestro rejects them.
- Prefer `id:` where a stable `resource-id` exists. Most of this app has none
  yet. Add `testID` props as you touch screens, and prefer them over labels.

### The development build blocks `launchApp`

Do not start a flow with `launchApp`. The simulator carries a dev client, so a
restart with no Metro attached lands on "Searching for development servers..."
and every later assertion fails for a reason unrelated to your change. The
flows in `e2e/` instead reset with an `onFlowStart` hook that dismisses an open
modal.

Two consequences, both real:

- **The Expo dev menu is an e2e hazard, and closing it is not enough.** It is a
  sheet over your app. While it is open, taps on the app underneath do nothing
  and assertions fail with a screenshot that looks almost right. On 2026-09-17
  it reopened during every single suite run on a contended device, so a
  dismiss step in `onFlowStart` did not make the suite green. Treat a run
  against a dev client as advisory, and read the screenshots in
  `~/.maestro/tests/<run>/<flow>/screenshots/` before believing a red result.
- **This cannot go in CI as is.** `mobile-ota.yml` and `mobile-release.yml` run
  on `ubuntu-latest` and Maestro needs a Mac. A standalone build
  (`eas build --profile simulator-release --platform ios`) with the bundle embedded fixes
  both this and `launchApp`. Until then `test:e2e` is a local, pre-release gate.

### The Mac needs Java, and it is not a system install

Maestro is a Kotlin/JVM application and needs Java 17+. That Mac has no system
JDK and no Homebrew. The runtime is a self-contained Temurin 21 in
`~/.local/jdk`, installed on 2026-09-17, and `scripts/maestro.ts` points
`JAVA_HOME` at it. If Maestro starts reporting "Unable to locate a Java
Runtime", that directory is gone; reinstall it rather than adding a system JDK:

```bash
curl -fsSL -o /tmp/jdk21.tar.gz \
  "https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jdk/hotspot/normal/eclipse"
mkdir -p ~/.local/jdk && tar xzf /tmp/jdk21.tar.gz -C ~/.local/jdk --strip-components=1
```

### Recording

`--plan ... --record` composes the step video here from a `simctl` capture and
the runner's log. `--flow ... --record` uses `maestro record --local`, which
renders the mp4 on the Mac. Plain `maestro record` uploads your screen capture
to mobile.dev to render it there. Always keep `--local`.

## Fallback only: synthesising clicks with CGEvent

**Prefer Maestro, above.** This section is kept because it still describes the
only way to drive Simulator chrome that is outside the app (the dev menu, a
system alert Maestro cannot see), and because the traps in it are real and were
expensive to find. Do not use it for in-app interaction.


### Tapping: there is no `simctl tap`. Calibrate off the accessibility tree.

`simctl` cannot synthesise touches and `idb` is not installed on this Mac.
Drive the Simulator window with CGEvent instead, and get the mapping from the
Simulator's own accessibility tree rather than guessing the bezel inset — the
window's `group` element is the device surface reported at **1:1 in device
points**, so `screen = group.origin + device_point`:

```bash
# Read the group's origin/size (size should equal the device's logical points,
# e.g. 440x956 on a 17 Pro Max — the 1320x2868 screenshot divided by scale 3).
ssh bennykok@bennys-macbook-pro-2 'osascript -e "tell application \"System Events\"
  to tell process \"Simulator\" to get {position, size} of (UI elements of
  (first window whose name contains \"Pro Max\") whose role description is \"group\")"'
```

Then post `kCGEventLeftMouseDown`/`Up` at `origin + point` via Quartz. Convert
a screenshot pixel to a device point by dividing by the scale factor (3 on
these devices). Raise the right window first (`AXRaise`) — clicks go to
whatever is under the coordinate, not to a device id.

**AXRaise before EVERY interaction, not once at the start.** This Mac runs
several agents' simulators in parallel, and window focus (which window is
*key*, not just which is visually on top) drifts between your taps as other
agents' sessions raise their own windows. Calibrating the `group` origin once
is fine — that geometry doesn't move — but skipping the `AXRaise` before a
later tap is how a perfectly-computed coordinate lands on nothing: the tap
event still posts, the screenshot still looks like your app, and there is no
error, because your window is still visible, just not key. Re-raise
immediately before every tap/drag/keystroke:

```bash
osascript -e '
tell application "Simulator" to activate
delay 0.15
tell application "System Events" to tell process "Simulator"
  perform action "AXRaise" of (first window whose name contains "YOUR_SIM_NAME")
end tell
' && python3 /tmp/tap.py $X $Y
```

**Typing text: `System Events`' `keystroke` silently no-ops over SSH.** It is
the third variant of this trap (alongside `booted` and stale `AXRaise`) found
in one session: `osascript -e 'tell application "System Events" to keystroke
"..."'` returns success and produces no error, but nothing appears in the
focused field — most likely missing Automation/TCC permission for the process
running osascript over SSH (a separate permission bucket from Accessibility,
which mouse clicks already have). Mouse taps via raw `CGEventPost` work fine
because they never go through System Events at all. Use the same technique
for keyboard input — `CGEventCreateKeyboardEvent` +
`CGEventKeyboardSetUnicodeString` lets you post arbitrary Unicode text
without needing a keycode table:

```python
import sys, Quartz
text = sys.argv[1]
down = Quartz.CGEventCreateKeyboardEvent(None, 0, True)
Quartz.CGEventKeyboardSetUnicodeString(down, len(text), text)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
up = Quartz.CGEventCreateKeyboardEvent(None, 0, False)
Quartz.CGEventKeyboardSetUnicodeString(up, len(text), text)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)
```

Tap the field (with a fresh `AXRaise` first) before sending text — this posts
keys to whatever's focused, it doesn't focus anything itself.

Fast refresh applies edits in a couple of seconds, so the probe-and-look loop
below is cheap. Use it instead of reasoning about what UIKit "should" do.

**Changes to `app/_layout.tsx` are the one place NOT to trust Fast Refresh
for verification.** It restructures the root navigator, and edits there (a
`key` prop, a new top-level effect) can silently fail to apply through
incremental HMR while every other screen-level edit in the same session
applies instantly and correctly — nothing errors, the old behavior just
keeps running. If you're testing a `_layout.tsx` change and the result looks
unchanged, do a full `simctl terminate` + `simctl launch` before concluding
the fix doesn't work.

## Probe with colour when a layout is a mystery

Reading RNScreens source and reasoning about `edgesForExtendedLayout` produced
a confident, wrong answer twice. Painting views in primary colours answered it
in one reload each:

- Suspect view red, the one above it semi-transparent green — then look at which
  colour actually reaches the screen. If your fill never appears, it is covered,
  and whatever you concluded about layering is wrong.
- Set a text style to red to find out whether a label is missing or merely
  drawn underneath something.

Revert the probe colours before committing.

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v58.0.0/ before writing any code.

## SDK / Expo Go coupling — read before bumping

This project is on **SDK 58**, which is a PREVIEW release
(`expo@58.0.0-preview.4`, `react-native@0.88.0-rc.1`), taken on 2026-09-22 to
reach the iOS 27 App Intents surface through `expo-app-intents`. There is no
Expo Go 58, so use a development build. Expect to re-run
`npx expo install --fix` as 58 moves toward stable.

As of 2026-07-26, Expo Go for SDK 57 was **not on the App Store** — Expo was
still awaiting Apple's approval, so it had to be obtained via `eas go`. If you
open this project in an App Store Expo Go, it fails with "Project is
incompatible with this version of Expo Go" and there is no update to install.
The project was briefly pinned to SDK 56 for exactly this reason.

Expo Go ships only the **latest released** SDK, and its version number now
tracks the SDK (56.0.4, 57.0.5, …). Before bumping the SDK, check that the
matching Expo Go is actually on the App Store:

```bash
curl -s https://api.expo.dev/v2/versions/latest \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s).data.sdkVersions;for(const[k,x]of Object.entries(v))if(+k.split('.')[0]>=54)console.log(k,x.iosClientVersion)})"
```

and cross-check the SDK changelog at https://expo.dev/changelog/ for an
"awaiting approval" note. Alternatively, move off Expo Go to a development
build (`eas build --profile development`), which removes the coupling entirely.

## Responsibility

`mobile/` owns the native Expo client for omg.dev. It is named `omg` in
`app.json`, with the bundle identifier `dev.omg.computer`. It is not the
separate `app-blocker` product.

The root repository owns the local agent runtime and session lifecycle. The
`vibes` repository owns hosted authentication, billing, waitlist, and product
contracts used by this client.

## Source of truth

- `package.json` and `bun.lock` define the installed Expo stack.
- Expo configuration files define native capabilities and bundle settings.
- Use the documentation for the exact installed Expo SDK version.
