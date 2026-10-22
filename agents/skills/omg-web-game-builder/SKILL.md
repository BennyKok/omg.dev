---
name: omg-web-game-builder
description: Build a small 2D or 3D browser game for phones (arcade, top-down, racing, puzzle, kids, word, simple 3D) in an omg.dev project made from the web-game template. The kit already has the engine, the full game UI, three themes, daily challenge, friend challenges, sharing, sound, tracking and SEO. Replace the sample game; do not rebuild the kit.
metadata:
  short-description: Build a 2D or 3D phone web game from the omg.dev game kit
---

# Build a phone web game from the kit

The `web-game` template is a finished game (Coin Dash) on Vite + React + TypeScript. Your job is to replace its rules, view, text and art with the user's game. Mobile first: a portrait phone of 390 x 844, one thumb. Desktop must work too.

## Fixed rules

1. Start the live preview before anything else (build order step 1). Then write code: plan in at most 10 lines, then edit. One file or one feature per turn, then `bun run typecheck`.
2. Never rebuild what the kit has (list below). Do not add a game engine, a UI library or @react-three/fiber.
3. Game rules are pure functions in `src/games/<game>/logic.ts`: no React, DOM, drawing, `Date.now()` or `Math.random()`. Use `seeded(seed)`. The same seed must give the same game: daily and challenge rounds depend on it.
4. No server, no sign-in. Progress stays in `localStorage` (the kit does it).
5. Every claim in text must match what the game does.
6. Verified means seen working: `bun run check:play` passed and you looked at its screenshots at phone size. An HTTP 200 from the live link is not a test. `check:play` is headless and needs no desktop or browser window.

## What the kit already does (do not rebuild)

- Fixed-step loop, keyboard and touch input (drag anywhere, stick, d-pad, steer, action buttons, multi-touch, two players, mouse drag on a computer), camera, collision, pause on tab hide.
- One game UI for 2D and 3D in `src/ui/`: menu, HUD strip (score badge, hearts, timer, pause), pause, results, unlocks, How to play and FAQ, Rotate your phone, toasts, router, saved profile.
- Themes in `src/ui/theme.ts`: `softCandy` (default), `glassNeon`, `cleanMinimal`. `?theme=glassNeon` previews another one.
- Best score and unlocks; daily challenge (date seed, number from launch day, streak); challenge links `?c=<seed>&s=<score>&n=<name>` with cleaned params and "You won / You lost" plus "Send it back"; share with `navigator.share` or clipboard copy; Web Audio sound after the first tap with a remembered mute; vibration that fails silently.
- `track(name, data)` with `game_open`, `game_start`, `game_over`, `play_engaged` (45 s), `share`, `challenge_open`, `daily_complete`. It logs to the console and sends to omg analytics on a published page. `useRun` in play.tsx sends them; do not send them again.
- 100dvh, safe areas, no scroll or zoom, touch targets of 48 px, reduced motion.
- SEO built from `src/app/about.ts`: title, description, Open Graph, share image, VideoGame and FAQPage data. The install manifest comes from the omg Vite plugin with `public/icons/`.

## Pick 2D or 3D

2D by default (about 100 KB gzip of script). 3D only when the idea needs depth; it adds three.js (about 137 KB gzip), loaded while the menu shows and never in a 2D build. Switch with the ONE line in `src/app/view.ts`, then delete the unused view file.

## Pick the control

Set it once in `src/app/about.ts`, `GAME.controls`: `kind`, `touchHint` (menu on a phone) and `keysHint` (menu on a computer). `play.tsx` passes `GAME.controls.kind` to `<TouchControls>`. The two hints and `howToPlay` must describe that same control. Never write "drag" for a game with buttons, or "tap the arrows" for a drag game. `check:ui` and `check:play` fail a hint that names another control.

| Game | `kind` | Player does | Rules read |
| --- | --- | --- | --- |
| Paddle, catch, runner, lane dodger, slingshot | `drag` | drags anywhere on the field | `axisX`/`axisY`; with `mode="absolute"`, `dragTarget` so the paddle sits under the finger |
| Top-down, free movement, twin-stick | `stick` | thumbs the joystick, bottom left | `axisX`/`axisY` |
| Grid moves: maze, snake, sokoban | `dpad` | taps four arrows | `axisX`/`axisY` or `wasTapped` |
| Racing, lane switch with two keys | `steer` | holds left or right | `axisX` |
| One-tap: flappy, jump, timing | `buttons` | taps the action button | `wasTapped(input, "p1", "a")` |

Add action buttons with `buttons={[...]}` on any kind. `axes="x"` limits a drag to left and right. Keyboard always works: arrows or WASD, Space.

## Build order

1. **Preview first, before you edit any file:** in the project directory run `bun install` if `node_modules` is missing. Start `bun run dev` in the background (port 5174). Call `omg_expose_port` with port 5174, without `expoGo`. Tell the user: "The preview is ready in the card below. It updates while I build." Vite reloads the preview on every save from here on. When the first-run steps already did this, or port 5174 is already in use by this project's dev server, go on to step 2.
2. **Plan:** core loop in one line, control kind (table above), win, lose, score, and how a round ends (a clock, lives, or falling items). Put it in `README.md`.
3. **Rules:** copy `coin-dash/logic.ts` to `src/games/<game>/logic.ts`. Keep `createGame(players, seed)`, `stepGame(game, input, dt)`, `finalScore`, `events` (for sound), `UNLOCKS`, `shareLine`. Read input with `axisX/axisY/wasTapped`.
4. **View:** copy `view-2d.ts` (canvas: `drawWorld`, `drawShadow`, `loadImage`) or `view-3d.ts` (three.js: `createStage`, `chaseCamera`, `billboard`, `checkerTexture`; shared geometry, Lambert materials, blob shadows, no shadow maps). Draw the art slot image when set, a placeholder shape when not.
5. **Wire:** in `src/app/play.tsx` change the imports, the HUD numbers, `FEEDBACK` (sound per event), the buttons and the `run.finish({...})` line. Keep `<TouchControls kind={GAME.controls.kind}>`, `<HudScore icon={ART.scoreIcon}>`, `run.step` and `run.finish`.
6. **Words:** fill `src/app/about.ts` (name, title with search words, description, tagline, controls, launch day, orientation, how to play in 3 to 5 steps, tips, 4 to 6 FAQ).
7. **Art (required):** the kit ships Coin Dash sample art, and it must not reach the user's game. Pick the preset in `theme.ts`, or spread one and set the customer's colours. Make images with `omg_generate_image` in one style (a sheet, cut into transparent PNGs, the game under 3 MB) and replace every item:
   - `ART.hero` (the menu art under the logo) and `ART.scoreIcon` (the HUD score icon) in `src/app/art.ts`. Delete `public/art/hero.svg` and `public/art/score.svg`.
   - `ART.items` (one per unlock) and `ART.sprites`.
   - `public/icons/` (`pwa-192x192.png`, `pwa-512x512.png`, `pwa-512x512-maskable.png`, `apple-touch-icon.png` at 180) and `public/og.png` (1200 x 630).
   Then look at the menu, play and results screenshots: no red runner, no coins, no coin badge unless the game is about coins.
8. **Check:** `bun run typecheck`, `bun test`, `bun run check:ui`, then `bun run check:play`. `check:play` plays a round at 390 x 844 with touch: menu, Play, your control, pause, resume, results, console errors, sample art. Open every PNG in `.omg/ui-check/` and `.omg/play-check/`. Fix each FAIL and WARN, then run them again. Do not publish until `check:play` passes.
9. **Publish:** `omg_deploy`. The first publish needs `public/omg-store/1.png` to `3.png` (menu, play, results at 390 x 844). Wait a minute, then run `bun run check:play -- --url <live link>` and look at its screenshots. Report only what passed there.

Edit `src/ui/`, `src/game/` and `src/render/` only when a kit bug blocks you. Add helpers in your game folder.

## Phone rules

- Keep the viewport tag, `styles.css`, `page.ts`. Put HUD items inside `<Hud>`. Important controls stay in the bottom half.
- No `setInterval`, `setTimeout` or `Date.now()` for game time: count `dt`.
- No `alert`, `confirm`, `prompt`, external fonts or scripts.
- 3D: a few hundred meshes at most, reuse geometry and materials, no post-processing, no large textures.
- On phones the omg install bar sits below the game, and the game becomes a card above it. Do not hide or move it.

## Final report

1. Live link. 2. The game in one sentence. 3. What was tested and at which sizes, with the `check:play` result on the live link. 4. Screenshots of menu, play and results. 5. Known issues or next ideas (at most 5). Say whether 3D was checked on a real phone.

## Lessons already learned

- A button at the end of a row that scrolls sideways went off screen and players got stuck. `check:ui` fails such a button; keep key buttons on screen at 360 px.
- "Verified" was claimed right after a deploy while the live site still served the old build. Re-check after a short wait.
- Copies of a game drifted from the source. Build from one folder; never patch a copy.
- Fruit Catcher (22 Oct) said "Drag left or right to move the basket" over a pair of arrow buttons; dragging did nothing. Set `GAME.controls` and let `check:play` drive it.
- The same game shipped with the kit's red runner, coins, coin score badge and coin app icon. Step 7 replaces all of them; `check:play` fails on any sample file.
- The user saw no preview for 5 minutes because the port was never exposed. Step 1 comes before any edit.
- The agent wrote "the desktop browser was not running" and checked the live link with HTTP only. `check:play` is headless; run it on the live link.
- Ads optimised for a new custom event (`play_engaged`) were dropped. Start ads on a standard goal, switch once the event fires about 50 times a week.
