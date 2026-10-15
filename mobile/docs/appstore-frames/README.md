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

## Product page header and search results assets (iOS 27)

Apple added two optional creative assets on 2026-10-05. They show on iOS 27
and iPadOS 27 and later. You upload them to the App Store Connect Asset
Library. Apple reviews them apart from an app version.

| Asset | Output | Size | Apple's art safe area |
|---|---|---|---|
| Product page header | `creative/product-page-header.jpg` | 3840×1646 (21:9) | 1646×661 at (1097, 493) |
| Search results | `creative/search-results.jpg` | 3840×2560 (3:2) | 2168×1030 at (836, 765) |

Sources:
- Spec: <https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/>
- Guidance and templates: <https://developer.apple.com/app-store/asset-best-practices/>
- The safe areas are the `Art Safe Area` layers of Apple's Photoshop
  templates (`creative_assets-*_template-static.psd`), read on 2026-10-15.

### How iPhone shows them

Measured from the image in Apple's announcement
(<https://developer.apple.com/news/?id=ljpl7kyn>) against the Coast sample in
Apple's template:

- The header is shown much larger than the canvas suggests. iPhone portrait
  shows only about 1630×1058 px of it (x 1105–2735, y 278–1336), edge to
  edge across the screen, running up behind the status bar. That width is
  the safe area's width, so whatever fills the safe area fills the phone.
- Back and share buttons float over the top corners, at about (1300, 615)
  and (2620, 615) with a 92 px radius.
- The search asset is shown whole, as a 3:2 card under the app's name row.
  Apple's own example (Ridge Explorer) fills that card to about 7 percent
  from its edges, well outside the template's search safe area.

`contentBox` in `config.mjs` is the layout box. For the header it must sit
inside the safe area and the iPhone view, below the status bar and clear of
the buttons; the renderer checks all of this. For the search asset it covers
most of the card, as in Apple's example. `--safe-area` also writes
`product-page-header.iphone-view.jpg`, the part an iPhone shows.

### Design rules from Apple's guidance

- Devices and orientations crop everything outside the art safe area. The
  rest of the canvas is backdrop. Apple's own sample, "The Coast", works the
  same way: a full-bleed scene with the wordmark and one subject in the
  centre.
- The header is brand, not a feature tour. It has one idea for a first-time
  visitor. It builds on the app's welcome screen
  (`src/omg/onboarding-welcome.tsx`): the same `welcome-grass` figure, with
  the tagline "Keep building your ideas, wherever you are." The tagline is
  set in three lines so it keeps its size on a phone.
- The search asset is the same scene at 3:2, filling the card as Apple's
  example does. It shows no app screen: at search-card size the screen's text
  is too small to read. The risk of filling the card is that a surface which
  crops to the template's search safe area cuts the edges. Check that in the
  App Store Connect preview.
- No orange mark in either asset: the back button covers the header's
  corner, and the app icon sits directly under the header and above the
  search card.
- No prices, URLs (so no "omg.dev" text), awards, or other products or
  stores.
- No alpha channel. The output is JPEG, because Chromium writes PNG
  screenshots as RGBA even when they are opaque.

### Rendering

```sh
node render.mjs --creative-only               # header and search asset only
node render.mjs --creative-only --safe-area   # review copies with Apple's safe area drawn
```

The renderer fails if any element leaves its content box, so a longer phrase
or a larger figure cannot ship clipped or under a button. `*.safe-area.jpg` files are for review
only. Never upload them.

Layout numbers and the phrase are in `CREATIVE_ASSETS` in
`config.mjs`. The figure is cropped to its visible artwork (`figureCrop`), so
its grass patch rests on the bottom edge of the safe area, where the hill
crest runs.

### Backdrop

`art/meadow-21x9.jpg` was made with `google/nano-banana-pro` (4K, 21:9) on
2026-10-15, in the Notebook garden style of `mobile/assets/village`. The
search asset uses a centre crop of the same image. Prompt:

> Ultra-wide panoramic background illustration, edge-to-edge, flat, no border.
> Hand-drawn children's-book notebook style: warm ivory paper sky (#F4F1E8)
> with subtle paper grain, soft sage-green colored-pencil meadow, imperfect
> warm graphite fine doodle outlines, tiny sparse white daisies with gold
> centres, a few small pebbles and little grass strokes. The meadow is a
> gentle rolling hill that occupies the lower 45% of the image, rising to a
> soft low grassy mound exactly in the horizontal centre. The centre of the
> image is open and calm (the area will hold a character added later), with
> no flowers or objects in the central third. Toward the far left and far
> right edges: a few loose colored-pencil grass tufts and a couple of soft
> round shrubs, a faint distant tree line drawn in light pencil. Sky is
> mostly empty warm paper, two or three tiny loose pencil-drawn clouds near
> the outer edges only. Calm, airy, lots of negative space, tasteful, light
> colored-pencil texture. Absolutely no people, no animals, no text, no
> letters, no logos, no sun, no buildings, no UI.

### Before upload

- Check both assets in the App Store Connect preview, on iPhone and iPad, in
  both orientations and in Dark Mode. Apple does not publish where the app
  name and the Get button sit.
- The phrase is in English only. Add a localized render for each listing
  language, or upload the header to the English listing only.

Check the output:

```sh
identify -format "%f: %wx%h %[channels]\n" designed/creative/*.jpg
```

Expected: `3840x1646 srgb` and `3840x2560 srgb`, with no alpha.
