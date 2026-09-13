# Notebook garden

Approved direction: option 01 from the Agent Village doodle comparison.
Generated with the built-in imagegen tool on 2026-09-13. These are background
illustrations only. Agent marks, legs, status text and badges are rendered by
`src/omg/agent-village-widget.tsx`.

The six PNGs cover small, medium and large widgets in light and dark mode.
`src/omg/village-scene.ts` owns their standing points. If the path changes,
review those points in both colour schemes before replacing an asset.
Small backgrounds are exported at 510 × 510 pixels (3×). WidgetKit rejects
the original 1254 × 1254 images when archiving the small widget.
The App Group cache uses `notebook-v2`; change that revision when replacing art
so an existing install does not keep an old background.

## Generation prompts

Each light asset used the approved comparison sheet as its reference and this
prompt, with the family-specific substitutions below:

> Create a production background illustration asset for the APPROVED FIRST
> 'Notebook garden' option in the reference, ignoring other options. [ASPECT].
> One single flat edge-to-edge image, no widget border, no rounded corners,
> no cast shadow outside image, no comparison sheet. IMPORTANT REMOVE ALL TEXT,
> logos, characters, white circle bodies, legs, captions, typography, sun, UI.
> ONLY garden backdrop. Warm ivory paper #F4F1E8, soft sage green colored-pencil
> meadow, imperfect warm graphite fine doodle lines, tiny sparse daisies,
> pebbles and little grass strokes. No buildings, no trees, no bench. Match
> first reference illustration style closely. Leave top [SPACE]% and top left
> generous empty warm paper for live caption. A broad ivory S-shaped footpath
> winds from lower left foreground across the central area toward upper right.
> Path is wide and sparse so live agents can stand freely on it. Very few edge
> flowers, avoid central obstacles. Calm, tasteful notebook sketch, light
> colored-pencil texture; full bleed paper background. [DETAIL]

| Family | ASPECT | SPACE | DETAIL |
| --- | --- | --- | --- |
| Small | Square aspect ratio 1:1 | 30 | Simplify to two bends and only two flowers so it remains clear at 170px. |
| Medium | Wide landscape aspect ratio 2.14:1 | 30 | Two path bends; keep the garden in lower 70%, remains clear at 364x170px. |
| Large | Square aspect ratio 1:1 | 20 | Three path bends with ample standing space, remains clear at 364px. |

Each dark asset was an edit of its corresponding light asset:

> Edit only the palette of this Notebook garden widget background to a calm
> dark mode night version. Preserve EXACT composition, aspect ratio, winding
> footpath geometry, flowers, grass, stones, positions, all outlines. The live
> character placement will rely on identical path location. Replace ivory
> sky/paper with warm charcoal #232820, meadow with muted dark moss/sage,
> footpath with medium muted warm gray sage #666B56 to keep dark character legs
> readable. Colored-pencil lines subtly lighter on dark ground, cream daisies
> with tiny warm gold centers. Keep handmade graphite texture. No new objects,
> no characters, no text, no logo, no sun or moon, no border. Full bleed rectangle.

## Runtime limits

The Home Screen widget refreshes when the app opens or returns to the
foreground. Scheduled poses are still images. WidgetKit chooses when to show
them; this is not continuous animation. Adding the widget kind requires a new
native binary. An OTA update alone cannot register the extension.

Focused verification: `bun test ./scripts/village-widget.native-check.ts` and
`bun run typecheck` from `mobile/`. The tests execute Expo's compiled layout
with a minimal view recorder. They do not replace a native visual check.

Native verification on 2026-09-13: the widget extension built successfully
with Xcode. All three sizes were checked in light and dark mode on an
iPhone 17 Pro simulator with iOS 26.0. The fixture used the production widget
renderer and asset staging with sample fleet data. Signed-in fleet refresh
and device delivery were not exercised.
