# Current state

Read this first. It records what is true now. The nightly librarian agent
updates it from merged pull requests. Verify a fact in code before you depend
on it. Last refresh: 2026-10-08.

## Active work (last 14 days)

- **First run and previews**: preview-first tasks, Expo preview cards,
  Connect Expo for iPhone, Simulator streaming, clipped viewport fixes,
  design checks, and public first apps (#316, #318–#324, #328–#329, #331,
  #334–#335, #339, #341, #347, #368, #373).
- **Android builds**: cloud APK builds, committed app icons, and tool timeout
  handling (#357, #367, #370).
- **Agent media**: media generation billed to omg credits (#325).
- **Plans and mobile**: agent usage limits, matching iOS plan display, restyle
  tokens, starter pills, and Settings plan meters (#356, #361–#363, #366).
- **Sessions and OpenCode**: harness relaunch, recorded containment, refreshed
  agent rosters, per-session MCP registration, and 90 s tool calls (#330,
  #333, #365, #371–#372).
- **Computer**: writable state fallback, paused polling, Chrome startup, and
  removal of the screen-lock password prompt (#336–#337, #349–#350).
- **Web, connectors, and embed**: token exchange, paste-back sign-in, correct
  project chat selection, host toasts, hidden Bots/Board, and lazy Connectors
  loading (#315, #340, #342, #351–#352, #354–#355).
- **Security and updates**: signed-in tailnet access, dependency audit fixes,
  and fresh release lookup for self-update (#338, #344, #353).
- **Agent docs**: self-host pricing, current context and archive rules, and
  hosted web app sign-in guidance (#359, #374–#375).

## Open pull requests

- In progress: #364 (Deploy to Railyard button).
- Stale (no update for 30+ days): #252 (visual element inspection), #284
  (auto-agent acting tools), #287 (film mode and page navigation).
  Do not build on these without asking the owner.

## Where things are

- Ownership, task contract, verification, and release rules: `AGENTS.md`.
- Hosted product, billing, and fleet: the `vibes` repository.
- Native client: `mobile/` and `mobile/AGENTS.md`.
- Design and protocol documents: `docs/`. Check top `Status:` lines against
  code; the bot plans and team-tooling status still describe earlier stages.
- Old plans that were not built: `docs/archive/`. They are history, not current
  truth. Search tools skip this folder.
