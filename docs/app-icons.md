# omg.dev app icon

The app tile is the existing `#FF5530` orange omg.dev mark on `#FFFFFF` white.
`web/public/icon.svg` owns the local web and native artwork. Its disc and
circular cutout use the same geometry as the inline brand mark, with .82 tile
padding. Keep the tile white in both themes.

Run `bun run icons` to generate the web icons, touch icon, documentation image,
native launcher assets and omg agent avatar at 1x, 2x and 3x. Run
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

Native launcher, Android status, widget and notification-extension images need
another binary. App Store 1.0.16 build 92 was already WAITING_FOR_REVIEW on
2026-10-11, so this change must not replace that build or restart its review.
Prepare these assets for the next store update. OTA can update the in-app avatar.
