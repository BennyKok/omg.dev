# Current state

Read this first. The nightly librarian refreshes this file from merged pull
requests. Verify a fact in code before you depend on it.
Last refresh: 2026-11-11.

## Active work (last 14 days)

- **Local runtime**: omg.dev is local software since v0.7.0. Cloud sign-in,
  hosted-app commands, cloud builds, and paid media tools were removed
  (`a53393a5e`, `2cdf61627`, `70884fae4`). Embedding and `@omg-dev/app` were
  removed in v0.7.1 (`898522cf7`). The README describes the self-run version
  (#501). The former Cloud and deploy design is marked superseded (#504).
- **Computer**: macOS gained native screen capture, input, and clipboard
  support (#505). Full-screen cursor cleanup was fixed (#479).
  Personal Computer connections were retired (#493).
- **Runtime and repository**: snapfork bases install nested Bun projects for
  forks to share (#497). Native clients, legacy deploy templates, and internal
  files were removed (#498).
- **Web performance**: React Compiler covers hot components (#464); rail rows
  update selectively (#465). Web moved to Vite 8 and React 19.3 (#467–#468).
  Chat swipe-back was fixed (#471).
- **Navigation and templates**: Create separated templates and skills (#463).
  Host tutorials were drawn in the page flow (#477), and the web-game template
  was updated (#469).
  Hosted templates were later removed (`89f52e88c`).
- **Earlier hosted work**: Terra model selection (#459),
  deploy (#482), finding autopilot (#490), and the prebuilt embed bundle
  (#475) landed before the local-only changes above. These PRs do not establish
  current cloud support.
- **Security and dependencies**: audit fixes (#494), production address removal
  (#496), pinned Actions, release approval gates, and npm trusted publishing
  (#491) landed.
- **Release and docs**: release failures no longer file issues (#485).
  Nightly documentation refreshes continue (latest: #506).
- **Latest direct commits**: device connection and request approval are in the
  local UI (`baed18dc7`). Remote access has its own Settings page
  (`0e0f075c4`); desktop settings and composer layouts were updated
  (`119826c87`, `21266a1ea`). Desktop packaging is paused (`88e1928ac`).

## Open pull requests

- In progress: none.
- Stale (no update for 30+ days): none.

## Where things are

- Ownership, task contract, verification, and release rules: `AGENTS.md`.
- Local CLI, server, lifecycle, and agent adapters: `src/`.
- Local web UI: `web/`. Desktop shell: `desktop/`.
- Protocol and client libraries: `packages/protocol/` and `packages/client/`.
- Device linking: `src/devices/` and `docs/device-link.md`.
- Event hooks: `src/events/` and `docs/event-hooks.md`.
- Session plans: `docs/session-plan.md`. Terminal: `docs/terminal.md`.
- Hosted product, billing, and fleet: the separate `vibes` repository.
- Native clients: removed from this repository (#498).
- Design and protocol documents: `docs/`. Verify top `Status:` lines in code.
- Old plans: `docs/archive/`. Search tools skip this history folder.
