# App Store Screenshots: capture, upload, and replacement

Status as of 2026-08-17. This is the third attempt at this task — two prior
sessions died on it (one on capture, one on upload). The findings below cost
real time; read them before repeating the mistakes.

App: omg.dev iOS, App Store Connect app id `6800792515`.

## Required sizes

Apple buckets iPhone and iPad screenshots by display size. Only these two
buckets are currently populated:

| Bucket | Pixel size (portrait) | Covers |
|---|---|---|
| iPhone 6.9" Display | 1320 × 2868 | also satisfies 6.5" and 6.7" — ASC shows those as "Using 6.9" Display" once the 6.9" bucket has assets |
| iPad 13" Display | 2064 × 2752 | primary iPad bucket |

Landscape variants of the same sizes are also accepted but unused so far.
Up to 3 App Previews (video) and 10 Screenshots per bucket.

## Upload tooling: use ego-browser, not mac-chrome

**mac-chrome does not work for App Store Connect.** It automates a *cloned*
Chrome cookie jar on the Mac, and that clone does not carry Benny's
authenticated ASC session — navigating to the Media Manager URL bounces to
a login page with `authResult=FAILED` in the query string. This reproduces
even after a full `down` + `up` recycle of the automation browser; re-cloning
does not help, because the source session being cloned was never
ASC-authenticated to begin with (or Apple's step-up auth for ASC specifically
doesn't survive the clone — either way, don't retry this, it burned a full
session already).

**Use `ego-browser` instead.** It attaches to Benny's real, already-logged-in
browser profile on the Mac, so navigating straight to
`https://appstoreconnect.apple.com/apps/6800792515/distribution/ios/version/inflight/media-manager/iphone`
(or `/ipad`) lands signed in as him with no auth step at all.

Read `~/.claude/skills/ego-browser/SKILL.md` and
`~/.claude/skills/ego-browser/references/remote-bridge.md` directly with
`Read` — **do not invoke the `Skill` tool for ego-browser**, it has been
observed to kill the session on this setup.

### uploadFile() gotcha: paths resolve on the Mac

`uploadFile()` runs in the Mac's browser process and resolves paths against
the Mac's filesystem, not this box's. Push each file first:

```bash
REMOTE=$(ego-browser-push /path/to/screenshot.png)
```

then pass `$REMOTE` (something like `/tmp/ego-remote-uploads/screenshot.png`)
to `uploadFile()`.

**Filename collision trap:** `ego-browser-push` names the remote file by
`basename` only, with no directory separation per bucket. If the iPhone and
iPad sets both have a file named `01-home-session-list.png` (a natural
naming convention to use, and the one this project uses), pushing them
one after another **silently overwrites the first with the second** — no
error, and you upload the wrong image into a bucket. Rename locally to
something bucket-unique (`ipad-01-...png`, `iphone-01-...png`) before
pushing, every time.

### Finding the right file input

Each display-size bucket has its own hidden `<input type="file" multiple>`
already present in the DOM (no need to click "Choose File" first — clicking
just opens the OS picker, which automation can't drive anyway; go straight to
`uploadFile()` against the input). Collapsed accordion sections don't render
their input until expanded, so click the bucket header first if it isn't
already open. To identify which input belongs to which bucket reliably (DOM
order alone is fragile), tag it via a small `js()` snippet that walks up from
the input to the nearest ancestor whose text matches a `X.X" Display` pattern,
then target it by that marker in `uploadFile()`.

### Verifying the upload actually landed

Don't trust "no error was thrown" as success. After uploading, **reload the
page fresh** (`gotoAndWait`, then wait for the "Loading Screenshots and App
Previews..." placeholder to resolve — it can take a few seconds) and read the
"N of 10 Screenshots" count plus the actual filenames in the list. The counts
and filenames only mean something once they've survived a real reload, not
just the post-upload DOM update in the same page load.

## How screenshot replacement and reordering work

Confirmed by inspecting the live Media Manager DOM (not guessed):

- **There is no in-place "replace" or "swap" control.** Each screenshot list
  item has exactly one action button, "Delete". To replace an existing
  screenshot, delete it, then upload the new one via "Choose File" /
  `uploadFile()`. The new one lands at the end of the list, not necessarily
  in the old position.
- **Reordering is drag-and-drop**, implemented with `react-beautiful-dnd`.
  Each `<li>` has `data-react-beautiful-dnd-draggable="1"`, and the drag
  handle carries `aria-roledescription="Draggable item. Press space bar to
  lift"`. If coordinate-based drag automation proves unreliable, the
  accessible keyboard path works: focus the item, <kbd>Space</kbd> to lift,
  arrow keys to move, <kbd>Space</kbd> to drop.
- A one-time informational dialog ("App Previews, Screenshots, and
  Localizations") appears the first time you touch a bucket in a session,
  explaining that the current display size's assets are reused for other
  sizes/localizations unless overridden. It has a single "OK" button; dismiss
  it, it doesn't block anything.

## Capturing screenshots on the simulator

### Chrome overlapping the simulator makes clicks land on the browser, silently

The single biggest time-sink in earlier attempts: when driving the simulator
via `osascript`/System Events `click at {x, y}`, if a Chrome window happens to
overlap the simulator's screen region, **the click lands on Chrome instead**
and System Events reports success regardless — no error, no exception, the
simulator just doesn't respond and you won't know why until you check what's
actually frontmost.

Fix, every time before clicking:

```bash
osascript -e 'tell application "Simulator" to activate'
osascript -e 'tell application "System Events" to tell process "Simulator" to perform action "AXRaise" of window "<exact window title>"'
```

Even with the Simulator frontmost and raised, a plain AppleScript
`click at {x, y}` via System Events **often still does not register** as a
tap on the app running inside the simulator. What reliably works is a raw
Quartz mouse-down held briefly before mouse-up — an instantaneous down+up
does not count as a tap on-device:

```python
import Quartz, time
x, y = 1288.0, 622.0
down = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, (x, y), Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
time.sleep(0.12)  # ~120ms hold — needed; an instant click does not register
up = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, (x, y), Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)
```

So the reliable sequence is: activate Simulator, AXRaise the target window,
then Quartz mouse-down / ~120ms hold / mouse-up. Don't trust `click at`
alone.

### Prefer deep links over blind tapping

Where a deep link exists, use it instead of guessing coordinates — it's
deterministic and immune to both problems above:

```bash
xcrun simctl openurl <UDID> "omg://computers"   # Computer screen
xcrun simctl openurl <UDID> "omg://"            # reset to home screen
```

`omg://plan` currently renders "Not available on this build" on internal dev
builds (the dev client predates `expo-iap`) — expected, not a capture target.

To point a terminated/reloaded dev client at a specific Metro/Expo tunnel:

```bash
xcrun simctl openurl <UDID> "omg://expo-development-client/?url=<url-encoded tunnel URL>"
```

### Keychain sign-in cannot be transplanted between simulators

A signed-in session's keychain item (`_SFAuthenticatedCiphertext`) does not
carry over if you try to copy/transplant it into a different simulator to
skip sign-in. This was attempted and dead-ended in an earlier session — don't
retry it. If a simulator needs a signed-in session, sign in on that specific
simulator; there is no shortcut via keychain transplant.

### Capture discipline

- Terminate and reload both the app (`dev.omg.computer`) and the Expo dev
  client host (`host.exp.Exponent`) immediately before every capture — via
  `xcrun simctl terminate <UDID> <bundle-id>` then reopening via deep link.
  This avoids catching a stale/unloaded state (missing avatars, icons still
  loading, etc).
- Take the raw screenshot with `xcrun simctl io <UDID> screenshot <path>.png`,
  then verify the exact pixel dimensions with
  `sips -g pixelWidth -g pixelHeight <path>.png` before treating it as a
  candidate — don't eyeball it.
- Vet the actual on-screen content before using it, especially for any shot
  that shows a live session or transcript: reject anything containing
  sensitive or inside-baseball content (tax forms, legal entity fields,
  in-progress App Store submission details) even if it's otherwise a good
  shot.

## Known state that will go stale

- Screenshot #4 (auto agents / findings) currently reflects the **old**
  auto-agents UI (a roster view). Build 26 reworks this into a flat findings
  list, so #4 needs retaking once build 26 is available and confirmed
  stable — don't ship the current #4 as final.
- If a composer fade and/or transcript contrast pass lands first, recapture
  everything in one pass after both land, rather than recapturing twice.
