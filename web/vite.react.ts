import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";

// The React plugins for every LFG web build: the app (vite.config.ts) and the
// prebuilt embed (vite.lib.config.ts) that app.omg.dev renders.
//
// React Compiler 1.0 memoizes a component at build time, so its render no
// longer re-renders children whose inputs did not change. Before it, one
// keystroke in the home composer re-rendered about 45 components.
//
// plugin-react 6 no longer runs Babel itself. The compiler runs through
// @rolldown/plugin-babel with plugin-react's `reactCompilerPreset`, which is the
// same babel-plugin-react-compiler as before. (plugin-react's `compiler` option
// is a Rust port that its docs still call experimental.)
//
// Annotation mode: only a component or hook whose body starts with
// "use memo" is compiled. Compiling every component gave the same render
// counts in measurement, because the components that own frequently changing
// state are the ones that matter, but it grew the embed by 22% minified
// (30% gzip) against 4.6% for the annotated set. app.omg.dev budgets that
// bundle. See docs/react-compiler.md for the patterns a "use memo" component
// must avoid.
//
// `panicThreshold: "all_errors"` turns a skip into a build error. In annotation
// mode that applies only to the "use memo" components, so a change that would
// quietly un-memoize a hot component (a try/finally, a ref written during
// render) fails the build with the compiler's reason instead.
//
// `target: "19"` emits `react/compiler-runtime`, which React 19 ships. The
// embed keeps React external, so the host's React provides it.
export function reactPlugin() {
  return [
    react(),
    babel({
      presets: [reactCompilerPreset({ target: "19", compilationMode: "annotation", panicThreshold: "all_errors" })],
    }),
  ];
}
