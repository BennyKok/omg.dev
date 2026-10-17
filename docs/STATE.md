# Current state

Read this first. It records what is true now. The nightly librarian agent
updates it from merged pull requests. Verify a fact in code before you depend
on it. Last refresh: 2026-10-17.

## Active work (last 14 days)

- **First run and previews**: web scaffolding, design checks, public first
  apps, Android template fixes, instruction-chip display, first-task web
  publishing and APK builds, and game first runs from the Expo game kit
  (#368, #373, #378, #382, #385, #392).
- **Android builds**: cloud APK builds, committed app icons, and tool timeout
  handling (#357, #367, #370).
- **App kits and default agent**: Haiku 5.5 default, web app and game kits,
  UI self-checks, and removal of the badge-moving step (#388–#389, #397).
- **Plans and mobile**: agent usage limits, matching iOS plan display, restyle
  tokens, starter pills, and Settings plan meters (#356, #361–#363, #366).
- **Sessions and OpenCode**: refreshed agent rosters, per-session MCP
  registration, and 90 s tool calls (#365, #371–#372).
- **Computer**: removal of the screen-lock password prompt,
  bounded screenshots, and reset of a stuck agent view (#350, #391).
- **Web, connectors, and embed**: host toasts, hidden Bots/Board, lazy
  Connectors loading, and owner connector access for scheduled auto agents
  (#351–#352, #354–#355, #383).
- **Cloud deploy**: deployment sends its session to Cloud and requests store
  screenshots (#395).
- **Media**: 3D generation and a $25 default daily media cap (#398).
- **Updates**: fresh release lookup for self-update (#353).
- **Agent docs**: self-host pricing, current context and archive rules,
  STATE.md refreshes, hosted web app sign-in, automatic sign-in/sign-out
  rules, and corrected bot plan status (#359, #374–#377, #380–#381, #387,
  #390, #394, #396, #399).

## Open pull requests

- In progress: #360 (close release failure issues after verified success),
  #364 (Deploy to Railyard button), #393 (game sprites move each frame
  without a React redraw).
- Stale (no update for 30+ days): #252 (visual element inspection), #284
  (auto-agent acting tools), #287 (film mode and page navigation).
  Do not build on these without asking the owner.

## Where things are

- Ownership, task contract, verification, and release rules: `AGENTS.md`.
- Hosted product, billing, and fleet: the `vibes` repository.
- Native client: `mobile/` and `mobile/AGENTS.md`.
- Design and protocol documents: `docs/`. Check top `Status:` lines against
  code; the team-tooling status still describes an earlier stage.
- Old plans that were not built: `docs/archive/`. They are history, not current
  truth. Search tools skip this folder.
