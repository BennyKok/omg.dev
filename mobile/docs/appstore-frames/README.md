# App Store screenshot frames

Turns raw omg.dev iOS simulator captures into designed App Store screenshot
frames: caption + device screenshot, composited to the exact pixel
dimensions Apple requires. Scriptable and rerunnable — built to survive the
captures being retaken (build 26 shipped an auto agents rework, and an
aesthetic pass may land a composer bottom-fade and stronger transcript
borders, so the images this was designed against are stand-ins).

## Design decisions

**Bezel-less, not framed.** Every capture already includes real device
chrome (status bar, Dynamic Island). A fake plastic bezel on top of that
adds ornament without adding trust — the audience is developers, and
restraint reads as quality here more than a marketing skin would.

**Caption above, device below.** Matches Apple's own App Store screenshot
convention and the app's own layout rhythm (title above content). Puts the
claim first, at a size that survives the App Store's small thumbnail grid.

**Background is the app's own color, not an invented one.** `#F2F2F7`,
sampled directly from the app's `systemGroupedBackground`. The frame reads
as an extension of the product, not a wrapper around it.

**Full-bleed, cropped from the top.** The screenshot fills the frame
edge-to-edge below the caption, with rounded top corners only — no side or
bottom margin. Every screen these captures show (session list, transcript,
findings) puts its most relevant content first/topmost by construction, so
a top-anchored crop is safe as a *rule*, not just for these specific
images: it keeps the interesting content and trims whatever tab bar or
composer happens to sit at the bottom. This is also why there's no
per-image hand-tuning to redo when captures are retaken.

**One system across all 7 frames.** Same grid, same type weight, same crop
rule, iPhone and iPad alike — reads as one product shipped with care, not
seven one-off treatments.

**Type.** Inter Display Bold, bundled in `fonts/`. SF Pro isn't installed
on the Linux render host and its license doesn't permit redistributing it
in this repo; Inter is the standard open-source stand-in with matching
geometry (OFL-licensed, see `fonts/LICENSE.txt`). Negative tracking
(`-0.02em`) on the large display text, per Apple's own type guidance for
large sizes. Pure black on the app's own off-white — sampled from the
app's actual title text color, not an assumed value.

**Captions.** Short, concrete claims tied to what's literally visible in
that frame. No "unleash your workflow" register, no em dashes, no "not X,
but Y" balance.

## Layout

```
+-------------------------------+
|  Caption (bold, bottom-       |  <- headlineZoneHeight
|  aligned within this zone)    |
+-------------------------------+
|                                |
|   Device screenshot,           |  <- rest of canvas
|   full width, top corners      |     cropped from the top
|   rounded, cropped at the      |     of the source capture
|   canvas edge (no scaling —    |
|   captures are already at      |
|   target resolution)           |
|                                |
+-------------------------------+
```

All layout constants (`headlineZoneHeight`, `fontSize`, margins, corner
radius) live in `config.mjs`, one entry per device bucket.

## Usage

```sh
cd mobile/docs/appstore-frames
npm install
npx playwright install chromium   # skip if already cached (~/.cache/ms-playwright)

# Defaults to the standard capture/output paths on the dev machine:
node render.mjs

# Or point at different directories (e.g. a fresh recapture):
node render.mjs --src /path/to/omg-appstore-screenshots --out /path/to/output
```

`--src` must contain `iphone-6.9in/` and `ipad-13in/` subdirectories with
source PNGs already at the exact target resolution (1320×2868 and
2064×2752 respectively — that's what Apple requires and what the app's
capture tooling produces). The script fails loudly if a configured source
file is missing, and re-verifies the rendered viewport size against the
configured target before writing each frame.

### Changing captions, order, or which frames ship

Edit `config.mjs`:
- `CAPTIONS` — caption text, keyed by source filename stem.
- `BUCKETS` — which stems render, and in what order, per device bucket.
  The first two entries are what most people see in the App Store listing —
  keep the strongest idea there.
- `PLATFORMS` — per-bucket layout constants (font size, margins, crop
  split between caption zone and device zone).

Then re-run `node render.mjs`. Nothing else needs to change when captures
are retaken with the same filenames — that's the point.

### Verifying output dimensions

Apple rejects anything that isn't an exact match. After rendering:

```sh
# ImageMagick
identify -format "%f: %wx%h\n" designed/iphone-6.9in/*.png designed/ipad-13in/*.png

# or Node, no extra deps
node -e "
const {execSync}=require('child_process');
console.log(execSync('file designed/iphone-6.9in/*.png designed/ipad-13in/*.png').toString());
"
```

Expected: `1320x2868` for every `iphone-6.9in/*.png`, `2064x2752` for every
`ipad-13in/*.png`.
