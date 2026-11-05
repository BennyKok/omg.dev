# Current state

Read this first. The nightly librarian refreshes this file from merged pull
requests. Verify a fact in code before you depend on it.
Last refresh: 2026-11-05.

## Active work (last 14 days)

- **Models and routing**: Auto, Max, Balanced, and Fast lead the hosted picker;
  models come from the router. Auto starts projects on omg/build and changes
  model on the next message (#448, #450, #452–#454). Credit refusals say
  "out of AI credit" (#449). Codex offers GPT-6.1 Terra (#459).
- **Home and navigation**: Create, Apps, and Chats on phones; local projects,
  app chat boxes, tutorials, compact cards, owner faces, stable project moves,
  and shared page navigation (#419, #423–#425, #427, #429, #431, #434,
  #440, #445). Apps and folders share one list (#461). Create separates
  templates and skills (#463). The surface draws the host tutorial (#477).
- **Web presentation and performance**: Create colour, masked pills, heading
  fixes, full-screen images, and phone toast clearance
  (#426, #430, #432–#433, #435, #437–#439, #441). Chat swipe-back is fixed
  (#471). React Compiler covers hot components; rail rows update selectively
  (#464–#465). Web uses Vite 8 and React 19.3 (#467–#468).
- **Previews and transcripts**: Android and web links lead phone previews;
  signed image URLs load; launch text and builder instructions stay
  out of customer messages (#413–#415, #421).
- **App and game kits**: drag controls, preview-first checks, and web games
  by default (#418, #422, #428). The web-game template uses React 19.3
  and Vite 8.3 (#469).
- **Computer**: release keys left held by a viewer (#411). Hide the cursor
  after closing full screen (#479). Personal Computer connections are
  retired; local use and cloud Computers remain available (#493).
- **Embedding**: the prebuilt app bundle has no remaining React require (#475).
- **Cloud and apps**: payment setup and owner-name visibility are available
  from sessions (#457, #460). `omg deploy` works without a control-plane
  install (#482). Finding autopilot starts sessions for open findings (#490).
- **Runtime**: snapfork bases install nested Bun projects for forks to share (#497).
- **Dependencies and security**: audit fixes and mobile install patches landed
  (#494). A production host address and tailnet name were removed (#496).
- **Release**: verified releases start the omg.dev pin update through
  `omg_pin` (#442–#444). Release failures no longer file issues (#485).
  Nightly documentation refreshes continue (latest: #495).

## Open pull requests

- In progress: #491 (Actions and release security), #498 (remove the native
  app, legacy deploy templates, and internal files).
- Stale (no update for 30+ days): none.

## Where things are

- Ownership, task contract, verification, and release rules: `AGENTS.md`.
- Hosted product, billing, and fleet: the `vibes` repository.
- Native client: `mobile/` and `mobile/AGENTS.md`.
- Design and protocol documents: `docs/`. Verify top `Status:` lines in code.
- Old plans: `docs/archive/`. Search tools skip this history folder.
