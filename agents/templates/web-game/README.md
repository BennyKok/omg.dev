# __OMG_PROJECT_NAME__

A phone-first web game from the omg.dev web game kit (Vite, React, TypeScript). It plays in the browser on phones (touch) and computers (keyboard), and installs to the Home Screen. Progress stays in the browser. The sample game is Coin Dash; replace it with yours.

## Plan

- Core loop: move, grab coins, dodge blobs, beat the 40 s clock, see the score, play again.
- Controls: drag the stick (or arrows/WASD) to move, tap Dash (or Space) for a burst.
- Score: 10 per coin, 5 per heart left. Three hits end the round.

## Run

- `bun run dev`: dev server on port 5173. `?theme=glassNeon` or `?theme=cleanMinimal` previews another theme.
- `bun run typecheck`, `bun test`: types and the kit's rule tests.
- `bun run build`: static site in `dist/`. `bun run preview` serves it on port 4173.
- `bun run check:ui`: opens every screen at 390x844 and 360x640, plays `/play`, fails buttons that are off screen, and saves PNGs in `.omg/ui-check/`.

## Map

- `src/app/`: this game. `about.ts` (name, SEO text, how to play, FAQ), `art.ts` (image slots), `view.ts` (one line picks 2D or 3D), and the screens.
- `src/games/coin-dash/`: `logic.ts` (rules), `view-2d.ts`, `view-3d.ts`.
- `src/ui/`: the shared game UI and services: screens, HUD, controls, theme, styles, router, profile, run (daily and challenge rounds), sound, share, track.
- `src/game/`: engine parts with no drawing: loop, input, collision, camera, progress, daily, challenge, view contract.
- `src/render/`: `canvas2d.ts` and `three.ts`.
- `public/`: `icons/`, `og.png` (share image), and `omg-store/1.png` and up for store screenshots.

Read `.agents/skills/omg-web-game-builder/SKILL.md` before changing the game.
