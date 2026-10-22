---
name: omg-web-game-builder
description: Build a real-time web game (racing, arcade, top-down, platformer, puzzle, kids' learning, word) in an omg.dev project made from the web-game template. It runs in the browser on phones and desktops and installs to the Home Screen. Start from the game kit; do not design an engine.
metadata:
  short-description: Build a web game from the omg.dev web game kit
---

# Build a web game from the kit

The `web-game` template already has the engine: fixed-timestep loop, keyboard and touch input, camera, collision helpers, canvas drawing, HUD, menu, pause, results, unlocks, saved progress, and a working sample game (Coin Dash). It is Vite + React + TypeScript. The world draws on one `<canvas>`; the HUD, menus and touch controls are HTML on top. Your job is to replace the sample's content with the user's game. Do not design or write an engine.

## Rules for this build

1. Write code in your first turn. Do not plan at length. Decide the game's rules in at most 10 lines of thought, then edit files. Fix problems after they run.
2. Keep each turn small: one file or one feature, then run `bun run typecheck`. A long reasoning pass with no code is a failure.
3. Never reimplement what the kit has: loop, input, collision, camera, canvas, HUD, screens, storage.
4. Make the game real-time and playable before you add menus, art or unlocks. The sample already has menus.
5. Do not add a game engine or a UI library. The kit is enough for 2D games.

## Project and preview

Create the project with `omg_create_project` and `template: "web-game"`. If `node_modules` is missing, run `bun install` once. Start the dev server in the background with `bun run dev` (port 5173, all interfaces). As soon as it answers, call `omg_expose_port` with port 5173 so the user gets a preview card. Vite reloads on every save. Then edit.

## Files you edit (in order)

1. `src/game/theme.ts`: colours from the design. Also set `theme-color` in `index.html` to the new `background`.
2. `src/games/<your-game>/logic.ts`: copy `coin-dash/logic.ts`. Pure rules: `createGame()`, `stepGame(game, input, dt)`, `finalScore()`, `UNLOCKS`. No React, no DOM, no drawing, no `Date.now()`. Read input only through `axisX/axisY/wasTapped(input, "p1" | "p2", ...)`. Use `seeded()` for randomness.
3. `src/games/<your-game>/draw.ts`: copy `coin-dash/draw.ts`. Draw with `drawWorld` and `drawSprite` (coloured shapes, emoji `label`, or `image`). Use world units; the camera converts.
4. `src/app/play.tsx`: change the imports from coin-dash to your game. Set `kind` on `TouchControls` (`dpad`, `stick`, `steer`) and its `buttons` (`{ action: "a", label: "JUMP" }`). Change the `useLiveValue` HUD numbers. Keep the loop, keyboard, pause, canvas and finish wiring as it is.
5. `src/app/index.tsx`, `results.tsx`, `unlocks.tsx`: titles, text, and the `UNLOCKS` import. A new screen is a new file in `src/app/` and one line in `src/app/routes.tsx`.
6. `public/icons/`: replace the placeholder coin icons with the game's icon at the same sizes (192, 512, 512 maskable with a safe margin, 180 apple-touch). `omg_generate_image` can make one.

Do not write automated tests unless the user asks. Verify with the self-check instead (see Finish).

Do not edit `src/game/loop.ts`, `input.ts`, `collision.ts`, `camera.ts`, `progress.ts` unless a kit bug blocks you. Add helpers in your game folder.

## Kit API (use these names)

- `createLoop({ step })` and `useGameLoop(update, { paused, draw })`: `update(dt)` runs at a fixed 1/60 s step; `draw()` paints once per screen frame.
- `useLiveValue(() => ({ score, time }))`: HUD numbers. React redraws only when they change. Never put per-frame state in `useState`.
- `useCanvas()` and `<GameCanvas canvas={canvas} />`: one canvas that fills `.game-area`. In `draw`, `canvas.context()` gives a 2D context in CSS pixels; `canvas.size.current` gives `{ width, height }`.
- `drawWorld(ctx, cam, view, { background, worldSize }, (ctx) => ...)`, `drawSprite(ctx, { x, y, size | w,h, angle, color, shape, label, opacity, borderColor, image })`, `drawText`, `loadImage("/sprites/car.png")` (put files in `public/`).
- `createInput()`, `axisX/axisY`, `wasTapped`, `endFrame`, `setAction`, `setStick`. `useKeyboard(input, players, onEscape)`: P1 = WASD + Space/E; in two-player mode P2 = arrows + Enter. Escape pauses.
- `TouchControls players={1|2} kind="dpad|stick|steer" buttons={[...]}`: shows only on touch screens. Two-player mode splits P1 left and P2 right. For split screen, draw one view per player on the same canvas (see `play.tsx`).
- `circlesOverlap`, `rectsOverlap`, `circleRectOverlap`, `pushCircleOutOfRect`, `keepCircleInside`, `angleDiff`, `seeded`, `clamp`, `lerp`.
- `createCamera`, `followCamera(cam, target, dt, { velocity, lookAhead, world, viewW, viewH })`.
- `profileStore.finishRun({ gameId, score, stats }, UNLOCKS)`, `useProfile()`, `profileStore.select(group, id)`, `setSettings`. Saved in localStorage; a reload keeps it.
- `router.push("/play")`, `router.replace("/results")`, `router.back()`.
- Screens: `MenuScreen`, `PauseOverlay`, `ResultsScreen`, `UnlocksScreen`, `SettingsRow`, `GameButton`. HUD: `Hud`, `HudStat`, `HudBar`, `Banner`.

## Phone and browser rules

- The page is full screen with no scroll and no pinch zoom. Keep `styles.css`, `src/game/page.ts` and the `index.html` viewport tag. Put new HUD or buttons inside `.game-area`, not in a new scrolling container.
- Keep controls in the `TouchControls` bar below the game, not over it. Touch targets are at least 44 px.
- Do not use `setInterval`, `setTimeout` or `Date.now()` for game time. Count the loop `dt`.
- Do not use `alert`, `confirm` or `prompt`. Use `PauseOverlay` or a screen.
- Keep progress in `profileStore`, not component state: a reload must keep best scores and unlocks.
- Sound must start from a tap or key press (browsers block audio before one). Respect `profile.settings.sound`.

## 3D games

The kit is 2D. For a 3D game (a real need, not a style choice), keep the loop, input, HUD and screens, and replace only the canvas drawing: `bun add three @types/three`, create a `THREE.WebGLRenderer({ canvas })` on the `GameCanvas` element, and render it in `draw`. Copy positions from your game object in `draw`; run `stepGame` in `update`. Keep the HUD and controls as HTML on top. Say in the final message that 3D was checked only in a desktop browser if you could not check a phone.

## Finish

Run `bun run typecheck` and `bun test`. Then run `bun run check:ui`: it builds the game, opens every screen at 390x844 with touch, saves one PNG per screen in `.omg/ui-check/`, holds keys on `/play` to confirm the canvas moves, and reports blank screens, error text, console errors, failed requests, and buttons covered by another element. Open each PNG, compare it with the request and any design references, fix what is wrong, and run it again until the report is clean. The check does not finish a round, so also play it once in the preview: it must move, end, show the results screen, and keep the best score after a reload.

Publish with `omg_deploy` from the project folder. It builds with `bun run build` and serves `dist/` as a static web app. The first publish needs store screenshots: save up to 3 PNGs of the main screens at 390x844 as `public/omg-store/1.png`, `2.png`, `3.png` (the menu, the game in play, the results), then publish. After you publish, open the live URL at phone size. On phones the omg install bar sits below the game, which becomes a card above it, so the bar covers no game controls. Do not move or hide it.
