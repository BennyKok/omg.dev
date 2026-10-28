# React Compiler in the web UI

Status: on for every web build since 2026-10-28, in annotation mode
(`web/vite.react.ts`).

React Compiler 1.0 memoizes a component at build time. A compiled component
re-creates a child element only when that child's inputs change, so React
skips the child's render. Only a component or hook whose body starts with
`"use memo";` is compiled.

The annotated components own state that changes often: `NewSessionDialog`,
`SessionChatBody`, `SkillTextarea`, `LiveView`, `RailStage`, `SessionCard`,
`ToolGroup`, `SessionReparentProvider`, `SessionReparentTarget`,
`ProjectPreviewCard` and `SessionPromptPanel`.

Measured with React Scan on a production build (2026-10-28):

| Interaction (live list updates excluded) | Component renders before | After |
| --- | --- | --- |
| One keystroke, home composer | about 45 | about 8 |
| One keystroke, session composer | about 37 | about 7 |
| Ten idle seconds on home | about 1,100 | about 500 |

Compiling every component gave the same render counts, but it grew the
embedded bundle by 22% minified (30% gzip). The annotated set grows it by
4.6% minified (7% gzip). app.omg.dev budgets that bundle.

Unit tests run without the compiler (`bun test` does not use Vite). A
component must behave the same compiled and uncompiled.

## A "use memo" component must compile

`panicThreshold: "all_errors"` makes a compiler skip in an annotated component
a build error, with the compiler's reason. These patterns cause a skip:

| Pattern | Use instead |
| --- | --- |
| `try` with `finally`, `try` without `catch`, `throw` inside `try`, or `?.` `??` `&&` `? :` inside `try` | `attempt` / `attemptAsync` from `web/src/lib/attempt.ts` |
| `ref.current = value` during render ("latest value" refs) | `useLatestRef(value)` from `web/src/lib/use-latest-ref.ts` |
| Reading `ref.current` during render, including in a default parameter | Read it in an effect or a handler |
| `// eslint-disable-next-line react-hooks/exhaustive-deps` to call the latest function from an effect | `useEffectEvent` (React 19.2) |
| A manual `useMemo` / `useCallback` whose dependency list is incomplete | A plain expression; the compiler memoizes it on its real inputs |
| Writing to a prop (a ref prop included) | A module-level helper, such as `assignRef` in `App.tsx` |
| `??=` | `if (x == null) x = value` |
| A function used before its declaration | Declare it first |

Two patterns compile but defeat the memoization:

- A handler prop that closes over draft text changes on every keystroke.
  Pass `useLatestCallback(fn)` from `web/src/lib/use-latest-ref.ts`.
- A child element written inside a large conditional JSX expression shares
  that expression's memo slot. Build it into its own const first
  (`const micButton = <MicButton ... />`). The same applies to a render helper
  such as `folderPicker("pill")`: call it once into a const.

## Components that are not compiled

`ChatStream` uses TanStack Virtual's `useVirtualizer`, which the compiler
rejects as an incompatible library on purpose. Its row offsets are written by
the virtualizer itself (`directDomUpdates`), so a scroll re-renders it only
when the mounted range changes.

`App` reads `usePendingSessionLink` during render. It re-renders about once
per session status change, so the gain is small for the risk of changing
deep-link handling.

Every live status change still re-renders each session-list row. The session
list replaces every session object when one session changes, so a memoized row
would still see a new `session` prop. Sharing unchanged session objects
between lists is the next step.

## How to check a component

- To see what re-renders, start `bun run dev` in `web/` and load
  `react-scan/dist/auto.global.js` before the app. React Scan names each
  component that renders and how often.
- To see why the compiler skips a component that is not annotated yet, run
  `babel-plugin-react-compiler` through `@babel/core` 7 with a `logger` option
  and print each `CompileError` event (its `fnLoc` gives the component's line).
  Babel 8 reports false errors with compiler 1.0.
