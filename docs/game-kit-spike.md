# Game kit spike: rendering stack

Status: decided 2026-10-12. Scratch copies were under `~/.cache/lfg/tmp/c2-spike`.

## Question

Which rendering stack works in the Expo template on web and on native for 2D games and for 3D games?

## Result

| Need | Stack | Extra dependency | Expo Web | Native |
| --- | --- | --- | --- | --- |
| 2D arcade, top-down, puzzle, kids | React Native `View` and `react-native-svg`, redrawn from a `requestAnimationFrame` loop | none (both are in the template) | Verified: the sample game played, scored, finished, saved its best score, and ran two-player split screen | Not run. Same primitives as the Opus Micro Circuit build. Unverified |
| 3D | `three` and `@react-three/fiber` (`/native` entry with `expo-gl`) | `three`, `@react-three/fiber`, `expo-gl` | Verified: a lit, rotating cube rendered in the Expo Web build | The Android JS bundle (`expo export --platform android`, Hermes) compiled with `@react-three/fiber/native` and `expo-gl`. Rendering on a device or in Expo Go not run. Unverified |

Rejected:

- Plain `<canvas>`: web only. It needs a second renderer for native.
- `@shopify/react-native-skia`: fast, but web needs a CanvasKit WASM download and async start, and Expo Go support lags SDK releases. Too many moving parts for a cheap model.
- A web view hosting the game: one renderer everywhere, but input, saved progress and screens then cross a bridge, and omg.dev previews show Expo Web, not a web view.
- Three.js for 2D: camera and mesh setup for flat shapes adds weight for no gain.

## Why views for 2D

The only working game build in the benchmark (Opus, Micro Circuit Racers) used this pattern. A few hundred shapes at 60 Hz is within budget on web. Game state lives in a ref, so a frame costs one React render and no per-object state.

Limits: thousands of sprites, particle storms and pixel effects need Skia or GL. The skill tells the builder to use fewer objects or the 3D path.

## 3D notes

- Pick the entry by file name: `scene.web.tsx` imports `@react-three/fiber`; `scene.tsx` imports `@react-three/fiber/native`.
- Run game rules in the kit loop (`useGameLoop`), not in `useFrame`. Rules stay testable.
- The first frames of the web canvas can be blank on a software renderer.
- The `expo-game` template adds no dependencies, so non-3D games stay light.

## Unverified

- Any native run (Expo Go, development build, simulator). No Android or Gradle build is allowed on this server, and no iOS simulator was used.
- The joystick (`PanResponder`) with a finger or a mouse drag. Keyboard play and the on-screen layout were checked.
- Multi-touch on native (two thumbs in two-player mode).
