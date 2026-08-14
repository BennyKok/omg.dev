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

Full loop — Metro here, simulator there:

```bash
# 1. Metro needs --tunnel: the Mac cannot reach this box's localhost.
cd mobile && npx expo start --tunnel --port 8081 > /tmp/metro.log 2>&1 &

# 2. Get the tunnel URL (it is NOT printed to the log).
curl -s localhost:4040/api/tunnels | python3 -c \
  "import json,sys;print(json.load(sys.stdin)['tunnels'][0]['public_url'])"

# 3. Point the dev client at it. The scheme is `omg` (app.json -> expo.scheme),
#    NOT `omgdev` — the bundle id is dev.omg.computer and confusing the two
#    gives a useless `OSStatus error -10814`.
ssh bennykok@bennys-macbook-pro-2 \
  'xcrun simctl openurl booted "omg://expo-development-client/?url=<TUNNEL_URL_ENCODED>"'

# 4. Wait for `iOS Bundled` in /tmp/metro.log, then LOOK.
ssh bennykok@bennys-macbook-pro-2 'xcrun simctl io booted screenshot /tmp/s.png'
scp bennykok@bennys-macbook-pro-2:/tmp/s.png /tmp/s.png
```

Fast refresh applies edits in a couple of seconds, so the probe-and-look loop
below is cheap. Use it instead of reasoning about what UIKit "should" do.

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
