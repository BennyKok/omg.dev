# Current state

Read this first. The nightly librarian refreshes this file from merged pull
requests. Verify a fact in code before you depend on it.
Last refresh: 2026-11-25.

## Active work (last 14 days)

- **Dashboard**: the shared To-do tab and `omg_todo` use the same local list
  (#518).
- **Agent sessions**: failed Claude turns appear in the transcript (#513).
  tmux stops parsing options before it sends typed text (#512). Skill
  suggestions use the active agent's skill catalog (#509).
- **Docs**: the accounts design records the People tab and pending server-side
  role enforcement (#515). STATE.md refreshes landed in #507–#508, #510–#511,
  #514, #516–#517, and #519–#522.

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
