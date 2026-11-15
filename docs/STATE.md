# Current state

Read this first. The nightly librarian refreshes this file from merged pull
requests. Verify a fact in code before you depend on it.
Last refresh: 2026-11-15.

## Active work (last 14 days)

- **Local runtime**: omg.dev became local software in v0.7.0. Cloud sign-in,
  hosted-app commands, cloud builds, and embedding were removed
  (`a53393a5e`, `2cdf61627`, `898522cf7`). The README describes the self-run
  version (#501). The former Cloud and deploy design is superseded (#504).
- **Computer**: native macOS screen capture, input, and clipboard landed
  (#505). Personal Computer connections were retired (#493). The local
  Computer page uses voxl by default (`1f21df9a5`).
- **Runtime and repository**: nested Bun installs are shared by snapshot forks
  (#497); bases older than a nested project are rejected (`bbd6bf3fa`). Native
  clients, legacy deploy templates, and internal files were removed (#498).
  OpenCode provider retry waits no longer leave turns stuck (`afc1e25a3`).
- **Devices and peers**: local device connections and approvals are in the UI
  (`baed18dc7`); incoming requests and notifications appear across the UI
  (`2f7895388`). Linked remote omg.dev machines share the sidebar and switcher
  (`8bfe61c5c`); their sessions open in place (`ac4cac00b`).
- **Agents and session tools**: Google Antigravity uses its official ACP server
  (`38ff557b8`). Its picker lists Google plan models; account verification,
  tool approval, and plan usage are handled (`316c151ce`, `f607a70f2`,
  `98745dd95`). Event hooks act on new events (`7720e01b8`). The plan pane
  shows steps and child sessions (`21a8fa14f`, `cbb7e8e55`). The terminal has
  docked tabs and snapshot resume (`bd56dff91`).
- **Web UI**: Remote access has its own Settings page (`0e0f075c4`). Recent
  fixes cover activity navigation, secure input gestures, image pinch gestures,
  and composer position (`8d93f981b`, `b127a4caf`, `56136fae3`, `8c028aa7a`).
- **Security and dependencies**: audit fixes (#494), production address removal
  (#496), pinned Actions, release approval gates, and npm trusted publishing
  (#491) landed.
- **Earlier hosted work**: finding autopilot (#490) landed before the
  local-only changes. This PR does not establish current cloud support.
- **Release and docs**: desktop packaging is paused (`88e1928ac`). The latest
  release commit is v0.7.8 (`9983b663a`). STATE.md refreshes landed in
  #487, #492, #495, #499, #500, #503, #506, #507, and #508.

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
