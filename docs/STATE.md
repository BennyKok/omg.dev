# Current state

Read this first. The nightly librarian refreshes this file from merged pull
requests. Verify a fact in code before you depend on it.
Last refresh: 2026-10-31.

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
  signed frames and image URLs load; launch text and builder instructions stay
  out of customer messages (#403, #413–#415, #421).
- **App and game kits**: drag controls, preview-first checks, and web games
  by default (#418, #422, #428). The web-game template uses React 19.3
  and Vite 8.3 (#469).
- **Computer**: release keys left held by a viewer (#411). Hide the cursor
  after closing full screen (#479).
- **Embedding**: stale-chunk reload message, composer-top host slot, guide
  navigation, conversation binding, and send acknowledgement (#401, #405,
  #409). The prebuilt app bundle has no remaining React require (#475).
- **Cloud and apps**: hosted app rename, paid-flow checkout tests, payment
  setup, and owner names are available from sessions (#406–#407, #457, #460).
  `omg deploy` works without a control-plane install (#482).
- **Release**: verified releases start the omg.dev pin update through
  `omg_pin` (#442–#444). Release failures no longer file issues (#485).
  Nightly documentation refreshes continue (latest: #483).

## Open pull requests

- In progress: #393 (game sprites move each frame without a React redraw),
  #417 (survive memory and inotify exhaustion from agent commands),
  #484 (bound Computer navigation and recover a stuck agent view).
- Stale (no update for 30+ days): #252 (visual element inspection), #284
  (auto-agent acting tools), #287 (film mode and page navigation).
  Ask the owner before building on these.

## Where things are

- Ownership, task contract, verification, and release rules: `AGENTS.md`.
- Hosted product, billing, and fleet: the `vibes` repository.
- Native client: `mobile/` and `mobile/AGENTS.md`.
- Design and protocol documents: `docs/`. Verify top `Status:` lines in code;
  the team-tooling status still describes an earlier stage.
- Old plans: `docs/archive/`. Search tools skip this history folder.
