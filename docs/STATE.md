# Current state

Read this first. The nightly librarian refreshes this file from merged pull
requests. Verify a fact in code before you depend on it.
Last refresh: 2026-11-06.

## Active work (last 14 days)

- **Models and routing**: Auto, Max, Balanced, and Fast lead the hosted picker;
  models come from the router. Auto starts projects on omg/build and changes
  model on the next message (#448, #450, #452–#454). Credit refusals say
  "out of AI credit" (#449). Codex offers GPT-6.1 Terra (#459).
- **Home and navigation**: shared page navigation (#445), one Apps list for
  apps and folders (#461), separate templates and skills on Create (#463),
  and host tutorials drawn in the page flow (#477).
- **Web presentation and performance**: Create heading and dock fixes (#441),
  chat swipe-back fix (#471), React Compiler on hot components (#464),
  selective rail updates (#465), and Vite 8 with React 19.3 (#467–#468).
- **App and game kits**: the web-game template starts with React 19.3,
  Vite 8.3, and omg 0.4.60 (#469).
- **Computer**: hide the cursor after closing full screen (#479).
  Personal Computer connections are retired (#493).
- **Embedding**: the prebuilt app bundle has no remaining React require (#475).
- **Cloud and apps**: payment setup and owner-name visibility are available
  from sessions (#457, #460). `omg deploy` works without a control-plane
  install (#482). Finding autopilot starts sessions for open findings (#490).
- **Runtime**: snapfork bases install nested Bun projects for forks to share
  (#497). The native app, legacy deploy templates, and internal files were
  removed (#498).
- **Dependencies and security**: audit fixes and mobile install patches (#494),
  production address removal (#496), pinned Actions, release gates, and npm
  trusted publishing (#491).
- **Release and docs**: verified releases start the omg.dev pin update through
  `omg_pin` (#442–#444). Release failures no longer file issues (#485).
  Nightly documentation refreshes continue (latest: #499).

## Open pull requests

- In progress: none.
- Stale (no update for 30+ days): none.

## Where things are

- Ownership, task contract, verification, and release rules: `AGENTS.md`.
- Hosted product, billing, and fleet: the `vibes` repository.
- Native client: removed from this repository (#498).
- Design and protocol documents: `docs/`. Verify top `Status:` lines in code.
- Old plans: `docs/archive/`. Search tools skip this history folder.
