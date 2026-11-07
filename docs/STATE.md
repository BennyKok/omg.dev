# Current state

Read this first. The nightly librarian refreshes this file from merged pull
requests. Verify a fact in code before you depend on it.
Last refresh: 2026-11-07.

## Active work (last 14 days)

- **Local runtime**: omg.dev is local software since v0.7.0. Cloud sign-in,
  hosted-app commands, cloud builds, and paid media tools were removed
  (`a53393a5e`, `2cdf61627`, `70884fae4`). Embedding and `@omg-dev/app` were
  removed in v0.7.1 (`898522cf7`). These changes supersede the hosted features
  in the recent PRs below. The README describes the self-run version (#501).
- **Runtime and repository**: snapfork bases install nested Bun projects for
  forks to share (#497). Native clients, legacy deploy templates, and internal
  files were removed (#498).
- **Web performance**: React Compiler covers hot components (#464); rail rows
  update selectively (#465). Web moved to Vite 8 and React 19.3 (#467–#468).
  Chat swipe-back was fixed (#471).
- **Navigation and templates**: Apps and folders shared one list (#461),
  Create separated templates and skills (#463), host tutorials were drawn in
  the page flow (#477), and the web-game template was updated (#469).
  The local phone UI now opens Chats with Folders, Inbox, and Computer beside
  it (`dff826b70`). Hosted templates were removed (`89f52e88c`).
- **Computer**: full-screen cursor cleanup was fixed (#479). Personal Computer
  connections were retired (#493). The local viewer now uses voxl by default
  (`1f21df9a5`).
- **Earlier hosted work**: models, routing, and credit messages (#448–#450,
  #452–#454, #459), app payments and identity (#457, #460), deploy (#482),
  finding autopilot (#490), and the prebuilt embed bundle (#475) landed before
  the local-only changes above. Do not use these PRs as current cloud support.
- **Security and dependencies**: audit fixes (#494), production address removal
  (#496), pinned Actions, release approval gates, and npm trusted publishing
  (#491) landed.
- **Release and docs**: release failures no longer file issues (#485).
  Nightly documentation refreshes continue (latest: #500).

## Open pull requests

- In progress: none.
- Stale (no update for 30+ days): none.

## Where things are

- Ownership, task contract, verification, and release rules: `AGENTS.md`.
- Local CLI, server, lifecycle, and agent adapters: `src/`.
- Local web UI: `web/`. Desktop shell: `desktop/`.
- Protocol and client libraries: `packages/protocol/` and `packages/client/`.
- Hosted product, billing, and fleet: the separate `vibes` repository.
- Native clients: removed from this repository (#498).
- Design and protocol documents: `docs/`. Verify top `Status:` lines in code.
- Old plans: `docs/archive/`. Search tools skip this history folder.
