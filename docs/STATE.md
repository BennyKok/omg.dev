# Current state

Read this first. The nightly librarian refreshes this file from merged pull
requests. Verify a fact in code before you depend on it.
Last refresh: 2026-11-16.

## Active work (last 14 days)

- **Local runtime and repository**: the README presents the self-run version
  (#501). Native clients, legacy deploy templates, and internal files were
  removed (#498). Snapshot fork bases install nested Bun projects so forks
  share the installs (#497).
- **Computer**: native macOS screen capture, input, and clipboard landed
  (#505). Personal Computer connections were retired (#493).
- **Security and dependencies**: audit fixes and mobile install patches
  landed (#494). A production host address and tailnet name were removed
  (#496). Actions use pinned SHAs; releases have approval gates; npm uses
  trusted publishing (#491).
- **Earlier hosted work**: finding autopilot starts sessions for open
  findings (#490). This merged PR does not establish current cloud support.
- **Docs**: the former Cloud and deploy design is marked superseded (#504).
  STATE.md refreshes landed in #492, #495, #499, #500, #503, #506, #507,
  #508, and #510.

## Open pull requests

- In progress: #509 (scope skill suggestions to the active agent).
- Stale (no update for 30+ days): none at refresh time.

## Where things are

- Ownership, task contract, verification, and release rules: `AGENTS.md`.
- Local CLI, server, lifecycle, and agent adapters: `src/`.
- Local web UI: `web/`. Desktop shell: `desktop/`.
- Protocol and client libraries: `packages/protocol/` and `packages/client/`.
- Device linking: `src/devices/` and `docs/device-link.md`. Peers: `src/peer-machines.ts`.
- Event hooks: `src/events/` and `docs/event-hooks.md`.
- Session plans: `docs/session-plan.md`. Terminal: `docs/terminal.md`.
- Hosted product, billing, and fleet: the separate `vibes` repository.
- Native clients: removed from this repository (#498).
- Design and protocol documents: `docs/`. Verify top `Status:` lines in code.
- Old plans: `docs/archive/`. Search tools skip this history folder.
