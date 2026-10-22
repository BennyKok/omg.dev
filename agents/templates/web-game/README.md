# __OMG_PROJECT_NAME__

A web game built from the omg.dev web game kit (Vite, React, TypeScript). It runs in the browser on phones and desktops, with touch controls on phones and the keyboard on a computer, and it installs to the Home Screen. Progress and settings are stored in the browser.

## Run

- `bun run dev`: dev server on port 5173 (all interfaces). In an omg.dev Cloud Computer, expose port 5173 for a preview.
- `bun run typecheck`, `bun test`: types and the kit's rule tests.
- `bun run build`: static site in `dist/`. `bun run preview` serves it on port 4173.
- `bun run check:ui`: opens every screen at 390x844, plays `/play` for a second, and saves PNGs in `.omg/ui-check/`.

## Kit map

- `src/game/`: the engine parts. Loop (`loop.ts`, `use-game-loop.ts`), input (`input.ts`, `use-keyboard.ts`, `stick.ts`), collision (`collision.ts`), camera (`camera.ts`), canvas drawing (`draw.ts`), saved profile (`progress.ts`, `profile-core.ts`, `profile-store.ts`), screens by URL hash (`router.ts`), theme (`theme.ts`), phone page rules (`page.ts`).
- `src/components/`: `world.tsx` (the game canvas), `controls.tsx` (d-pad, steer, joystick, buttons, two-player bar), `hud.tsx`, `screens.tsx` (menu, pause, results, unlocks).
- `src/games/coin-dash/`: the sample game (`logic.ts` rules, `draw.ts` art). Replace it with your game.
- `src/app/`: `index` (menu), `play`, `results`, `unlocks`, and `routes.tsx` (the screen list).
- `public/icons/`: install icons (placeholders). `public/omg-store/1.png` and up: store screenshots, served at `/omg-store/1.png`.

Read `.agents/skills/omg-web-game-builder/SKILL.md` before changing the game.
