---
name: omg-web-game-builder
description: Build a small 2D or 3D browser game for phones (arcade, top-down, racing, puzzle, kids, word, simple 3D) in an omg.dev project made from the web-game template. The kit already has the engine, the full game UI, three themes, daily challenge, friend challenges, sharing, sound, tracking and SEO. Replace the sample game; do not rebuild the kit.
metadata:
  short-description: Build a 2D or 3D phone web game from the omg.dev game kit
---

# Build a phone web game from the kit

The `web-game` template is a finished game (Coin Dash) on Vite + React + TypeScript. Your job is to replace its rules, view, text and art with the user's game. Mobile first: a portrait phone of 390 x 844, one thumb. Desktop must work too.

## Fixed rules

1. Write code in your first turn. Plan in at most 10 lines, then edit. One file or one feature per turn, then `bun run typecheck`.
2. Never rebuild what the kit has (list below). Do not add a game engine, a UI library or @react-three/fiber.
3. Game rules are pure functions in `src/games/<game>/logic.ts`: no React, DOM, drawing, `Date.now()` or `Math.random()`. Use `seeded(seed)`. The same seed must give the same game: daily and challenge rounds depend on it.
4. No server, no sign-in. Progress stays in `localStorage` (the kit does it).
5. Every claim in text must match what the game does.
6. Verified means seen working: you ran it and looked at the screenshots at phone size.

## What the kit already does (do not rebuild)

- Fixed-step loop, keyboard and touch input (stick, d-pad, steer, action buttons, multi-touch, two players), camera, collision, pause on tab hide.
- One game UI for 2D and 3D in `src/ui/`: menu, HUD strip (score badge, hearts, timer, pause), pause, results, unlocks, How to play and FAQ, Rotate your phone, toasts, router, saved profile.
- Themes in `src/ui/theme.ts`: `softCandy` (default), `glassNeon`, `cleanMinimal`. `?theme=glassNeon` previews another one.
- Best score and unlocks; daily challenge (date seed, number from launch day, streak); challenge links `?c=<seed>&s=<score>&n=<name>` with cleaned params and "You won / You lost" plus "Send it back"; share with `navigator.share` or clipboard copy; Web Audio sound after the first tap with a remembered mute; vibration that fails silently.
- `track(name, data)` with `game_open`, `game_start`, `game_over`, `play_engaged` (45 s), `share`, `challenge_open`, `daily_complete`. It logs to the console and sends to omg analytics on a published page. `useRun` in play.tsx sends them; do not send them again.
- 100dvh, safe areas, no scroll or zoom, touch targets of 48 px, reduced motion.
- SEO built from `src/app/about.ts`: title, description, Open Graph, share image, VideoGame and FAQPage data. The install manifest comes from the omg Vite plugin with `public/icons/`.

## Pick 2D or 3D

2D by default (about 100 KB gzip of script). 3D only when the idea needs depth; it adds three.js (about 137 KB gzip), loaded while the menu shows and never in a 2D build. Switch with the ONE line in `src/app/view.ts`, then delete the unused view file.

## Build order

1. **Plan:** core loop in one line, controls, win, lose, score. Put it in `README.md`.
2. **Rules:** copy `coin-dash/logic.ts` to `src/games/<game>/logic.ts`. Keep `createGame(players, seed)`, `stepGame(game, input, dt)`, `finalScore`, `events` (for sound), `UNLOCKS`, `shareLine`. Read input with `axisX/axisY/wasTapped`.
3. **View:** copy `view-2d.ts` (canvas: `drawWorld`, `drawShadow`, `loadImage`) or `view-3d.ts` (three.js: `createStage`, `chaseCamera`, `billboard`, `checkerTexture`; shared geometry, Lambert materials, blob shadows, no shadow maps). Draw the art slot image when set, a placeholder shape when not.
4. **Wire:** in `src/app/play.tsx` change the imports, the HUD numbers, `FEEDBACK` (sound per event) and the `run.finish({...})` line. Set the `TouchControls` kind and buttons. Keep `run.step` and `run.finish`.
5. **Words:** fill `src/app/about.ts` (name, title with search words, description, tagline, launch day, orientation, how to play in 3 to 5 steps, tips, 4 to 6 FAQ).
6. **Look:** pick the preset in `theme.ts`, or spread one and set the customer's colours. Fill `src/app/art.ts` slots (logo, background, hero, items, sprites) with images from `omg_generate_image`: make a sheet in one style, cut transparent PNGs, keep the game under 3 MB. Replace `public/icons/` (192, 512, 512 maskable, 180) and `public/og.png` (1200 x 630).
7. **Check:** `bun run typecheck`, `bun test`, `bun run check:ui`. Then play in a real browser at 390 x 844 and 360 x 640 with touch: a full round, pause, restart, mute, daily, a challenge link in a fresh browser, share, reload keeps the best score. No console errors. Every button fully on screen. Look at every screenshot. Fix, then run it all again.
8. **Publish:** `omg_deploy`. The first publish needs `public/omg-store/1.png` to `3.png` (menu, play, results at 390 x 844). Wait a minute, then repeat step 7 on the live link in a fresh browser.

Edit `src/ui/`, `src/game/` and `src/render/` only when a kit bug blocks you. Add helpers in your game folder.

## Phone rules

- Keep the viewport tag, `styles.css`, `page.ts`. Put HUD items inside `<Hud>`. Important controls stay in the bottom half.
- No `setInterval`, `setTimeout` or `Date.now()` for game time: count `dt`.
- No `alert`, `confirm`, `prompt`, external fonts or scripts.
- 3D: a few hundred meshes at most, reuse geometry and materials, no post-processing, no large textures.
- On phones the omg install bar sits below the game, and the game becomes a card above it. Do not hide or move it.

## Final report

1. Live link. 2. The game in one sentence. 3. What was tested and at which sizes. 4. Screenshots of menu, play and results. 5. Known issues or next ideas (at most 5). Say whether 3D was checked on a real phone.

## Lessons already learned

- A button at the end of a row that scrolls sideways went off screen and players got stuck. `check:ui` fails such a button; keep key buttons on screen at 360 px.
- "Verified" was claimed right after a deploy while the live site still served the old build. Re-check after a short wait.
- Copies of a game drifted from the source. Build from one folder; never patch a copy.
- Ads optimised for a new custom event (`play_engaged`) were dropped. Start ads on a standard goal, switch once the event fires about 50 times a week.
