# LOOK AT THE APP. There is a real simulator, over Tailscale.

A UI change is not verified until you have SEEN it. `tsc --noEmit` and
`expo export` both pass on a layout that renders as an unreadable grey screen —
that happened on 2026-08-14, and a broken nav bar was committed and pushed on
the strength of those two green checks. Neither one can see a screen.

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

## Tapping: there is no `simctl tap`. Calibrate off the accessibility tree.

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

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## SDK / Expo Go coupling — read before bumping

This project is on **SDK 57**, which requires an Expo Go 57 client.

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
