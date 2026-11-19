# Current state

Read this first. The nightly librarian refreshes this file from merged pull
requests. Verify a fact in code before you depend on it.
Last refresh: 2026-11-19.

## Active work (last 14 days)

- **Agent sessions**: failed Claude turns appear in the transcript (#513).
  tmux ends option parsing before passing typed text (#512). Skill suggestions
  use the active agent's skill catalog (#509).
- **Local runtime and repository**: the README describes the self-run version
  (#501). Native clients and legacy deploy templates were removed (#498).
  Snapshot fork bases install dependencies for nested Bun projects (#497).
- **Computer**: native macOS screen capture, input, and clipboard landed (#505).
- **Security and releases**: a production host address and tailnet name were
  removed (#496). GitHub Actions use pinned SHAs, releases have approval gates,
  and npm uses trusted publishing (#491).
- **Docs**: the accounts design records the shipped People tab and pending
  server-side role enforcement (#515). The former Cloud and deploy design is
  marked superseded (#504). STATE.md refreshes landed in #499, #500, #503,
  #506, #507, #508, #510, #511, and #514.

## Open pull requests

- In progress: none at refresh time.
- Stale (no update for 30+ days): none at refresh time.

## Where things are

- Ownership, verification, and release rules are in `AGENTS.md`.
- The local CLI, server, lifecycle, and agent adapters are in `src/`.
- The local web UI is in `web/`. The desktop shell is in `desktop/`.
- The protocol and client libraries are in `packages/protocol/` and
  `packages/client/`.
- Device linking is in `src/devices/` and `docs/device-link.md`. Peer machines
  are in `src/peer-machines.ts`.
- Event hooks are in `src/events/` and `docs/event-hooks.md`.
- Session plan and terminal docs are `docs/session-plan.md` and `docs/terminal.md`.
- The separate `vibes` repository owns the hosted product, billing, and fleet.
- Design and protocol documents are in `docs/`. Check their status against the
  code. Search tools skip old plans in `docs/archive/`.
