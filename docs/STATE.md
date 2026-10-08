# Current state

Read this first. It records what is true now. The nightly librarian agent
updates it from merged pull requests. Verify a fact in code before you depend
on it. Last refresh: 2026-10-08.

## Active work (last 14 days)

- **First run and previews**: preview-first rules for every first task, Expo
  preview card (Web, Simulator, Your phone), Connect Expo for Expo Go on iPhone
  (#316–#331, #341, #368, #373).
- **Android builds**: `omg_build_android` builds an installable APK through omg
  Cloud (#357, #367, #370).
- **Agent media**: media generation tools billed to omg credits (#325).
- **Plan limits**: the server reports agents in use against the plan limit
  (#356). iOS plan display matches the web paywall (#366).
- **Mobile restyle**: staged port of the 2026-10 web restyle (#361–#363).
- **OpenCode**: omg MCP is registered per session; tool calls get 90 s (#365,
  #372).
- **Computer**: no screen-lock password prompt, Chrome starts without
  `/dev/shm`, paused Computers are not polled (#337, #349, #350).
- **Navigation**: Bots and Board are hidden from the side navigation (#354).

## Open pull requests

- In progress: #364 (Deploy to Railyard button), #360 (release failure issue).
- Stale (no update for 30+ days): #252, #284, #287. Do not build on these
  without asking the owner.

## Where things are

- Ownership, task contract, verification, and release rules: `AGENTS.md`.
- Hosted product, billing, and fleet: the `vibes` repository.
- Native client: `mobile/` and `mobile/AGENTS.md`.
- Design and protocol documents: `docs/`. A `Status:` line at the top, when
  present, says whether the design is built.
- Old plans that were not built: `docs/archive/`. They are history, not current
  truth. Search tools skip this folder.
