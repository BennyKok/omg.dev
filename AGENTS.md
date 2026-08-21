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
- Type check: `bun run typecheck`
- Package build: `bun run build:packages`
- Dependency audit: `bun run audit`
- Chat ingestion smoke test: `bun run chat:smoke`

Run full tests and typecheck sequentially. Package-build tests can temporarily
replace workspace artifacts and cause false module-resolution errors.
Use a real install in each worktree. Do not share or symlink `node_modules`
between checkouts because stale dependencies cause false test and type errors.

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
