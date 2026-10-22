# __OMG_PROJECT_NAME__

A game built from the omg.dev Expo game kit. It runs on Expo Web, Expo Go, and development builds. Progress and settings are stored on the phone.

## Run

`bun run web` for the browser, `bun run preview` in an omg.dev Cloud Computer, `bun run typecheck` to check types, `bun run build` for the static web export.

## Kit map

- `src/game/`: the engine parts. Loop (`loop.ts`), live drawing (`live.ts`), input (`input.ts`), collision (`collision.ts`), camera (`camera.ts`), saved profile (`progress.ts`, `profile-store.ts`), theme (`theme.ts`). Hooks: `use-game-loop.ts`, `use-keyboard.ts`.
- `src/components/`: `controls.tsx` (d-pad, steer, joystick, buttons, two-player bar), `hud.tsx`, `screens.tsx` (menu, pause, results, unlocks), `world.tsx` (camera-aware `World`, `Sprite` and `Live`; pass moving objects as `of={obj}`).
- `src/games/coin-dash/`: the sample game. Replace it with your game.
- `src/app/`: `index` (menu), `play`, `results`, `unlocks`.

Read `.agents/skills/omg-game-builder/SKILL.md` before changing the game.
