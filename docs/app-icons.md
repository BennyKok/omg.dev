# omg.dev app icon

The app tile is the existing `#FF5530` orange omg.dev mark on `#FFFFFF` white.
`web/public/icon.svg` owns the local web and native artwork. Its disc and
circular cutout use the same geometry as the inline brand mark, with .82 tile
padding. Keep the tile white in both themes.

The coding-agent avatar uses the previous cream mark on a dark brown tile.
`web/public/agent-omg.svg` owns this separate artwork. The generator preserves
its dark palette and transparent corners for the native 1x, 2x and 3x PNGs.

Run `bun run icons` to generate the web icons, touch icon, documentation image,
native launcher assets and coding-agent avatar PNGs. Run
`bun run icons --check` to check decoded pixels, dimensions and alpha contracts.
`mobile/scripts/make-icons.py` forwards to this generator for old callers.

Platform masks own launcher corners. The Apple PNG has no alpha channel.
Android adaptive icons use a transparent orange foreground on a white
background. Android monochrome and status icons use a white alpha silhouette.
Inline wordmarks still use the surrounding page surface through their cutout.

The hosted product owns `apps/web/scripts/gen-brand-icons.cjs` in `vibes`.
Its app tiles and startup images use the same orange, white and cutout geometry.
Icon URLs carry a version query to avoid old browser and touch-icon caches.

Verification: the app-brand iPhone simulator plan renders the actual launcher
asset and production AgentAvatar in both themes. The recorded two-step plan
passed on iPhone 17 Pro, iOS 26.5. Generated assets and icon checks passed.
The hosted GaspAppIcon was rendered at three sizes in both themes in a browser.

The dark coding-agent avatar restoration passed all 12 icon tests, the generated
asset check, root/web/mobile type checks, and both recorded app-brand fixture
steps. This restoration is prepared locally and has not been deployed.

Native launcher, Android status, widget and notification-extension images need
another binary. App Store 1.0.16 build 92 was already WAITING_FOR_REVIEW on
2026-10-11, so this change must not replace that build or restart its review.
Prepare these assets for the next store update. OTA can update the in-app avatar.

## Deployment receipts, 2026-10-11

- Released `v0.6.221` from `cdc605eabc2780996ed11b05d333b763f26ea16e`.
  Release workflow `38134976114` passed and all 17 assets were published.
- Local main was landed through `scripts/land-session.sh`. The served bundle
  and canonical SVG were checked after the restart.
- Hosted tile update: `db4fce99d603dde38dad74346b89a0ca26a2e4a9`.
- Public-site update: `87979aa52d8e0b4a40f6328a13a0dabfc874c6fd`.
  The first landing build exited 137 and kept the prior site. The separate retry
  deployed the new image. All five live icon links were checked against source.
- Hosted app pin and avatar: `5143d8f99cc7224f0c4642a65d8aa23d1aa76514`.
  Web workflow `38135979629` passed. Both served avatar SVGs match the canonical
  artwork. Eighteen hosted tile/favicon files also matched their source bytes.

The OTA source is `616e5d2cad898aed83713806fd07b51f8f0e7437`, based on the
previous verified update source `658603ec878321ac04edf1815057576919dc6419`.
Its entire delta is the three omg avatar PNGs. Native configuration, plugins,
modules, launcher images and dependencies are unchanged. This keeps the
currently reviewed build intact. All eight served update IDs and all three
avatar asset hashes per manifest were checked.

| Channel | Runtime | Workflow | Update group |
| --- | --- | --- | --- |
| production | 1.0.15 | 38134918802 | `43748505-b694-4f6b-ade2-aee7e520f136` |
| production | 1.0.14 | 38135173054 | `06e3bdc4-71d1-4b49-87ed-57808f79109b` |
| production | 1.0.16 | 38135426488 | `5103f1e9-0f18-4261-9e3f-ff4d7b609c2e` |
| testflight-whistle | 1.0.16 | 38135679749 | `313d49f0-64d3-443f-b9c8-adc21fd42297` |

Verification passed: icon regeneration check, 11 icon tests, root/web/mobile
TypeScript checks, the two-step recorded iPhone fixture, 1,392 hosted web tests
(71 skipped), 357 landing tests, hosted and landing type checks, and web lint.
The Xcode-generated 1024px launcher PNG matches the canonical icon's decoded
pixels exactly. Android assets were checked for dimensions, safe padding and
alpha contracts. No Android native build or store submission was performed.

The full local-runtime suite reported 4,822 passing tests, one skip and 12
failures in unchanged CLI-version and older UI assertion tests. The hosted
Audit workflow `38135979642` also failed. It reported 84 unaccepted high/critical
advisories, an undici acceptance that expired on 2026-10-03, 15 stale baseline
entries, and two accepted exceptions that now have fixes.
The pin update only changed the three omg package URLs, not other package versions.
These failures remain outside this logo change.

App Store status was read again after publication: 1.0.16 build 92 still waits
for review; the public version remains 1.0.15. The new native launcher and
extension artwork stays prepared for the next binary. The macOS icon generator
also uses `mobile/assets/icon.png`, so its next build inherits this artwork. No review was restarted.

The hosted runtime bake check `38136184643` passed against the 0.6.221 pin.
Its live registry result was `agent-lfg v338`, `agent-lfg-v338-51805b8a`,
pointing at `44551d386ff3`. The final local frontend build serves 0.6.221
from `/assets/index-ftTZeqno.js`.

Backend deployment `38135979770` also passed for the same hosted pin commit,
including regional service checks. Public and control-plane health checks passed.
The current App Store review was read again at handoff and was left unchanged.
