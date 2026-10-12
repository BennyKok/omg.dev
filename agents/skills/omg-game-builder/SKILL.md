---
name: omg-game-builder
description: Build a real-time game (racing, arcade, top-down, platformer, puzzle, kids' learning, word, simple 3D) in an omg.dev Expo project made from the expo-game template. Start from the game kit; do not design an engine.
metadata:
  short-description: Build a game from the omg.dev game kit
---

# Build a game from the kit

The `expo-game` template already has the engine: fixed-timestep loop, keyboard and touch input, camera, collision helpers, HUD, menu, pause, results, unlocks, saved progress, and a working sample game (Coin Dash). Your job is to replace the sample's content with the user's game. Do not design or write an engine.

## Rules for this build

1. Write code in your first turn. Do not plan at length. Decide the game's rules in at most 10 lines of thought, then edit files. Fix problems after they run.
2. Keep each turn small: one file or one feature, then run `bun run typecheck`. A long reasoning pass with no code is a failure.
3. Never reimplement what the kit has: loop, input, collision, camera, HUD, screens, storage.
4. Make the game real-time and playable before you add menus, art or unlocks. The sample already has menus.

## Project

Create the project with `omg_create_project` and `template: "expo-game"`. Follow the Expo fast path in the `omg-app-builder` skill for the first preview. Then edit.

## Files you edit (in order)

1. `src/game/theme.ts`: colours from the design.
2. `src/games/<your-game>/logic.ts`: copy `coin-dash/logic.ts`. Pure rules: `createGame()`, `stepGame(game, input, dt)`, `finalScore()`, `UNLOCKS`. No React, no drawing, no `Date.now()`. Read input only through `axisX/axisY/wasTapped(input, "p1" | "p2", ...)`. Use `seeded()` for randomness.
3. `src/games/<your-game>/game-view.tsx`: copy `coin-dash/game-view.tsx`. Draw with `World` and `Sprite` (coloured shapes, emoji `label`, or `react-native-svg`). Use world units; the camera converts.
4. `src/app/play.tsx`: change the imports from coin-dash to your game. Set `kind` on `TouchControls` (`dpad`, `stick`, `steer`) and its `buttons` (`{ action: "a", label: "JUMP" }`). Keep the loop, keyboard, pause and finish wiring as it is.
5. `src/app/index.tsx`, `results.tsx`, `unlocks.tsx`: titles, text, and the `UNLOCKS` import.
6. `tests/`: test your `logic.ts` with `bun test` (step with a fake `Input`, assert score, collision, game over). Copy the pattern from `tests/coin-dash.test.ts` (build a game, set keys with `setAction`, call `stepGame` in a loop, assert).

Do not edit `src/game/loop.ts`, `input.ts`, `collision.ts`, `camera.ts`, `progress.ts` unless a kit bug blocks you. Add helpers in your game folder.

## Kit API (use these names)

- `createLoop({ step })` and `useGameLoop(update, { paused })`: update runs at a fixed 1/60 s step.
- `createInput()`, `axisX/axisY`, `wasTapped`, `endFrame`, `setAction`, `setStick`. `useKeyboard(input, players, onEscape)`: P1 = WASD + Space/E; in two-player mode P2 = arrows + Enter.
- `TouchControls players={1|2} kind="dpad|stick|steer" buttons={[...]}`: two-player mode splits P1 left and P2 right. For split screen, render two `GameView`s, one camera each (see `play.tsx`).
- `circlesOverlap`, `rectsOverlap`, `circleRectOverlap`, `pushCircleOutOfRect`, `keepCircleInside`, `angleDiff`, `seeded`, `clamp`, `lerp`.
- `createCamera`, `followCamera(cam, target, dt, { velocity, lookAhead, world, viewW, viewH })`.
- `profileStore.finishRun({ gameId, score, stats }, UNLOCKS)`, `useProfile()`, `profileStore.select(group, id)`, `setSettings`.
- Screens: `MenuScreen`, `PauseOverlay`, `ResultsScreen`, `UnlocksScreen`, `SettingsRow`, `GameButton`. HUD: `Hud`, `HudStat`, `HudBar`, `Banner`.

## Web pitfalls

- Measure the game area with `useViewSize()` (`onLayout`). `useWindowDimensions()` is 0 in a static web export until a resize.
- `Alert.alert` with buttons does nothing on web. Use `PauseOverlay` or an in-screen modal.
- Keep progress in `profileStore`, not component state: a reload must keep best scores and unlocks.
- Do not use `setInterval` or `Date.now()` for game time. Count the loop `dt`.
- Do not put per-frame state in React `useState`. Keep it in the game object (a ref); the hook redraws each frame.

## 3D games

The kit is 2D. For a 3D game (a real need, not a style choice), keep the loop, input, HUD and screens, and replace only `game-view.tsx`.

```bash
bunx expo install three @react-three/fiber expo-gl && bun add -d @types/three
```

Write two small files with the same exports, so Metro picks the right one:

- `src/components/scene.web.tsx`: `import { Canvas, useFrame } from "@react-three/fiber"`
- `src/components/scene.tsx`: the same code with `from "@react-three/fiber/native"`

Put a `<Canvas camera={{ position: [0, 0, 4] }}>` with an `ambientLight`, a `directionalLight` and one `<mesh>` per game object (boxes, spheres, planes, flat colours). Copy positions from your game object on each render; run `stepGame` in `useGameLoop`, not in `useFrame`. Keep the HUD and controls as normal React Native views on top of the canvas. The canvas needs a parent with a size (`flex: 1`).

Verified in the kit spike: a 3D scene renders in Expo Web, and the Android JS bundle compiles. Not verified: rendering on a device or in Expo Go. Say that in the final message.

## Finish

Run `bun run typecheck`, `bun test`, and `bun run build`. Check the game in Expo Web: it must move with keys, end, show the results screen, and keep the best score after a reload. Say which surfaces you tested; a web run is not proof of native behaviour.
