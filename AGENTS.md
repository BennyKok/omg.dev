# Agent Instructions

## Project responsibility

This repository owns the local omg.dev agent runtime. It owns the CLI, local
web UI, MCP server, session lifecycle, worktrees, project records, agent
adapters, and local artifacts.

It does not own the hosted omg.dev product, billing, account data, or
Firecracker fleet. Those concerns belong in the `vibes` repository. The
`mobile/` directory is the current source tree for the native omg.dev client.
Its hosted authentication, billing, and product contracts belong in `vibes`.
The separate `app-blocker` repository is a different product idea. More
specific client instructions live in `mobile/AGENTS.md`.

## Task contract

- Treat one user outcome as one task. Do not add nearby cleanup or features.
- If the objective changes, state the new boundary before you continue.
- Define the done condition before you edit. Separate implementation,
  verification, and delivery.
- Find the single owner for any state or event. Extend that owner instead of
  adding a second source of truth.

## Preflight

Before you edit:

1. Confirm the repository root and the responsible subsystem.
2. Confirm the runtime target: local process, hosted service, or mobile app.
3. Read the nearest `AGENTS.md` and the relevant code or design document.
4. Check the worktree state. Preserve unrelated changes. Use an isolated
   worktree when the active checkout is dirty.
5. Reproduce a bug or record the current behavior when practical.

Do not use old session text as the source of truth. Verify changing facts from
the current repository, runtime, or authoritative service.

## Change workflow

- Make the smallest structural change that fixes the stated problem.
- Keep one owner for lifecycle state, persistence, events, and cleanup.
- Update all consumers when you change a protocol or persistent shape.
- Keep migrations backward compatible unless the task explicitly permits a
  breaking change.
- Do not deploy, publish, release, or modify external state unless delivery is
  part of the task.
- Bind temporary servers to `127.0.0.1`. Stop them before you finish.

## Verification

Use the smallest relevant checks while you work. Expand verification with the
risk and delivery scope.

- Focused Bun test: `bun test <path>`
- Full test suite: `bun run test`
- Prebuilt embed smoke: `bun run test:embed`
- Type check: `bun run typecheck`
- Web type check: `cd web && bun x tsc --noEmit`
- Dependency audit: `bun run audit`
- Chat ingestion smoke test: `bun run chat:smoke`

The root type check does not cover `web/`. Run the web one too when you change
anything under `web/src`.

The web type check needs no build. The ROOT one still needs
`packages/client` built, because `src/plan-limit-error.test.ts` imports
`web/src/lib/omg-client.ts`, which imports `@omg-dev/client`. `exclude` stops
direct inclusion, not imports. The root program has no DOM library, so it
cannot read that package from source the way `web/tsconfig.json` does. In a
fresh worktree, run `bun run --cwd packages/client build` once. That is a few
seconds, not the full `build:packages`.

`bun run test` builds exactly two prerequisites: `packages/protocol` and
`packages/client`. That is the whole chain. `src/plan-limit-error.test.ts`
imports `web/src/lib/omg-client.ts`, which imports `@omg-dev/client`, which
resolves through its manifest to `dist`, and that `dist` imports the protocol
`dist`. Nothing else under test needs a build.

`packages/react` used to be a prerequisite and nothing imports it under test.
It was demanded only by the assertion in `scripts/test-builds.ts`, so every
fresh worktree paid a `tsc` build and a stylesheet copy for a guard rather
than a dependency. Do not add an entry to `TEST_BUILDS` to make a check pass.
Add one only when a test cannot resolve a module without it.

Run full tests and typecheck sequentially. Package-build tests can temporarily
replace workspace artifacts and cause false module-resolution errors.
Use a real install in each worktree. Do not share or symlink `node_modules`
between checkouts because stale dependencies cause false test and type errors.

### Do not assert on component source text

Do not test a component by reading its file and matching strings:

```ts
const APP = readFileSync(join(root, "web", "src", "App.tsx"), "utf8");
expect(APP).toContain('document.addEventListener("selectionchange", ...)');
```

This cannot tell a refactor from a regression. Renaming a local, lifting a
listener into a module, or deleting a file makes it fail while the behavior is
correct. It fails the same way when the behavior is genuinely broken, so the
failures stop being read. A roster preview that never showed "Working" sat
broken on `main` behind exactly such an assertion, because the red test looked
like the usual noise.

Render the component instead. `web/src/test-support/render.tsx` installs the
DOM globals and returns a mounted root:

```tsx
import { mount, type Mounted } from "../test-support/render";
const { Thing } = await import("./thing");

let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("shows the step", () => {
  ui.render(<Thing steps={steps} />);
  expect(ui.text()).toContain("Connect an agent");
});
```

`mount()` gives `render`, `flush`, `flushAsync`, `remount`, `text`, `query`,
`queryAll`, `host` and `cleanup`. Import the harness BEFORE the component, and
load the component with `await import()`. A static import is hoisted above the
global assignment and react-dom then binds to a window that does not exist.

There is no `@testing-library`. happy-dom plus `react-dom/client` and `act` is
enough, and the harness is the only copy of that setup.

Two constraints are real:

- A component that is not exported cannot be rendered. Most of `App.tsx` is in
  that state. Export it, or move it to its own file under `web/src/components`.
- Roughly 47 existing test files still assert on component source. They are
  being converted as the files they cover are touched. Do not add more, and do
  not treat their presence as approval of the pattern.

Server wiring is different: assert against the running behavior (call the
handler, hit the endpoint) rather than against `serve.ts` as a string.

### Do not build the web bundle to check your work

`bun run build:packages` and `vite build` are delivery steps, not verification
steps. Neither is needed to typecheck or to test.

- The type check reads package sources directly. `web/tsconfig.json` maps
  `@omg-dev/client` to `packages/client/src`, so a fresh worktree type checks
  with no build at all.
- `bun run test` builds only the prerequisites that are stale.

To look at a change in a browser, run `bun run dev` in `web/`. It proxies the
API to the local server, so the app works. Do not build a production bundle
and copy it over a running install.

A production build emits about 65 MB across roughly 400 chunks, and more than
half of that is source maps. Measured peak resident memory is 1.7 GB for
`build:lib`. Three agents doing that at once put this machine at load 44 with
24 percent iowait, and none of the builds finished. One agent later left an
orphaned `tsc` at 325 percent CPU for ten minutes by calling it with
`--ignoreConfig`, which bypasses every setting above. Use the project
configuration.

`web/dist-lib` is no longer a default test prerequisite. It was the largest
cost on the default path, because it lists `web/src` as an input. Any edit to
the UI marked it stale, so every `bun run test` rebuilt it. The full suite now
peaks at about 505 MB and takes about 49 seconds with no bundle build.

The embed smoke test moved to `web/src/embedded-lib-smoke.release-check.ts`.
`bun test` does not discover that name. `bun run test:embed` builds the bundle
and runs the smoke by explicit path. The release workflow runs the same script
after `build:packages`. A missing path makes `bun test` exit 1, so the check
cannot pass silently.

### Runtime choice for Vite

The dev server runs under Bun. `web/package.json` uses `bun --bun vite`.
Measured start is 423 ms, against 512 ms under Node.

Builds stay on Node. This is deliberate. Bun is faster in wall clock for
`build:lib`, at 26 seconds against 31 seconds. Bun also doubles peak resident
memory, at 3.18 GB against 1.72 GB. The failure this repository actually hits
is memory exhaustion from concurrent agents, not build latency. Do not move
the builds to Bun. `build:lib` does not hang under Bun. That earlier report
was wrong.

### Worktree disk cost

Bun hardlinks packages from the global cache. A per-directory `du` therefore
counts the same inode once for each worktree. A sample binary in
`node_modules/.bun` showed a link count of 55.

The naive sum of `du` over each worktree gives 176 GB for 101 worktrees. A
single `du` across the parent directory dedupes the hardlinks and gives 16 GB.
Use one `du` invocation over the parent when you measure worktree disk. Do not
sum per-worktree figures. An earlier 74 GB figure in session notes came from
this error.

Do not run the full suite after every small edit. Run it before delivery when
the change crosses subsystems or affects a release. If a check cannot run,
report the exact reason and the unverified risk.

## Delivery and handoff

- Implementation complete means the code and focused checks are complete.
- Delivery complete means the requested commit, push, release, or deployment
  is complete.
- Never claim a deployment from a successful local build or push.
- Monitor only the workflows that the requested delivery triggered. Do not
  poll unrelated jobs.
- Report four items: changed behavior, verification, delivery state, and any
  remaining risk.

### Landing and the local deploy restart

`scripts/land-session.sh` is the landing path. It rebases the session branch,
pushes to `origin/main`, syncs and builds the local main checkout, restarts the
service, and writes the deployed-head marker. The push is the part to confirm
first, because it changes shared state.

A deploy restart does NOT interrupt live agent sessions. Do not warn that it
does. The service unit sets `KillMode=process` for exactly this reason, so
systemd stops only the main `bun ... serve` process. Managed agent children and
the tmux panes for native TUI agents keep running, and the restarted service
adopts them. Read the unit before you make a claim about restart blast radius.
It states this in a comment.

Use `LFG_LAND_SKIP_RESTART=1` only when the task asks for a build with no
deploy. It is not a safety measure for other sessions.

## Versioning and releases

After a user-visible change lands on `main`, evaluate a release. Skip releases
for internal-only docs, CI, refactors, tests, or scripts.

For a release:

1. Check pending work with
   `git log --oneline $(git describe --tags --abbrev=0)..origin/main`.
2. Add a user-facing entry at the top of `CHANGELOG.md`.
3. Run `scripts/tag-release.sh`. Pass `minor` or `major` only when needed.

The script requires a clean, current `main`. It bumps the version, commits,
tags, pushes, and publishes the GitHub release bundle.

## Dependency advisories

`scripts/audit.ts` is the source of truth for dependency audits. It covers the
Bun workspace and the separate npm graph in `mobile/`.

- Put accepted advisories in `scripts/audit-exceptions.json` with a reason and
  a hard `reviewBy` date.
- Do not add `bun audit --ignore=` to the workflow.
- After a fix or dependency bump, run `bun run audit:exceptions`.
- When a new lockfile ecosystem appears, add its real audit tool to
  `AUDIT_ROOTS`. Do not hide it in an exclusion list.

## Reporting style

Write user-facing text in ASD-STE100 Simplified Technical English.

- Use one idea per sentence.
- Prefer short sentences and simple verbs.
- Do not use contractions.
- Keep exact commands, paths, identifiers, and error text unchanged.

This style rule does not change code, comments, commit messages, or quoted
source text.
