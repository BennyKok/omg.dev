# Current state

Read this first. It records what is true now. The nightly librarian agent
updates it from merged pull requests. Verify a fact in code before you depend
on it. Last refresh: 2026-10-26.

## Active work (last 14 days)

- **Hosted models and routing**: Auto, Max, Balanced, and Fast lead the picker;
  models come from the router. Auto routes new projects to omg/build, then
  uses Auto on the next message; no-project chats use the same routing
  (#448, #450, #452–#454). Credit refusals show "out of AI credit" (#449).
- **Home and navigation**: Create, Apps, and Chats on phones, local projects
  on Apps, tutorials, direct app chat boxes, on-demand Apps and GitHub import,
  compact cards, owner faces, stable project moves, and shared page navigation
  (#419, #423–#425, #427, #429, #431, #434, #440, #445).
- **Web presentation**: Create colour, masked pills, dock and heading fixes,
  full-screen chat images, and phone toast clearance
  (#426, #430, #432–#433, #435, #437–#439, #441).
- **Previews and transcripts**: Android and web links lead the phone preview;
  signed frames and image URLs load; launch text and builder instructions stay
  out of customer messages (#382, #403, #413–#415, #421).
- **App and game kits**: Haiku 5.5 default, web-safe app kit, game self-checks,
  web games by default, drag controls, and preview-first checks
  (#385, #388–#389, #392, #397, #418, #422, #428).
- **Computer**: bounded screenshots, stuck-view reset, and release of keys
  left held by a viewer (#391, #411).
- **Embedding and connectors**: scheduled agents use owner connectors;
  stale-chunk reload message, composer-top host slot, guide navigation,
  conversation binding, and send acknowledgement (#383, #401, #405, #409).
- **Cloud and apps**: deploy sends its session and requests store screenshots;
  hosted app rename, paid-flow checkout testing, and owner payment setup from
  a session (#395, #406–#407, #457).
- **Media**: 3D generation and a $25 default daily media cap (#398).
- **Release and agent docs**: verified releases start the omg.dev pin update;
  the pin tool is `omg_pin` (#442–#444). Nightly context refreshes:
  #387, #390, #394, #396, #399–#400, #404, #408, #410, #412, #447, #455–#456.

## Open pull requests

- In progress: #360 (close release failure issues after verified success),
  #393 (game sprites move each frame without a React redraw),
  #417 (survive memory and inotify exhaustion from agent commands).
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
