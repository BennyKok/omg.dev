# Hosted/injected shell inventory and unification ADR

Status: accepted, partially implemented. Owner: this repository (`web/`,
the `@omg-dev/app` library it publishes). The hosted product shell that
*consumes* this library — `app.omg.dev`, `BennyKok/vibes` `apps/web` — is out
of this repository's ownership per `AGENTS.md`; this document treats it as an
external, versioned consumer and records only what was verified by reading
its source, not by driving it live (see "Verification boundary" below).

## Trigger

A user reported the hosted omg.dev UI sometimes shows a small floating pill
with a Computer icon and a Settings gear, overlapping other chrome and
looking visually foreign against the rest of the page (screenshot: a phone
status bar — VPN badge, a focus/profile glyph, 64% battery — with the pill
sitting immediately below it, slightly overlapping).

## How many shell variations actually exist

Two independent axes produce the count: **how the host mounts LFG**, and
**which chrome branch LFG renders once mounted**.

### Axis 1 — host integration mechanism (2)

| Mechanism | Detection | Where | Status |
| --- | --- | --- | --- |
| Legacy iframe embed | `?embed=1` on the frame URL, or running inside a cross-origin iframe (defence in depth) | `web/src/lib/embed.ts`; protocol documented in `docs/embed-host-protocol.md` | Active, postMessage-based (`lfg:session-created`, resume signal). No DOM slot contract — the host cannot dock chrome into the frame at all; it owns 100% of its own UI outside the iframe boundary. |
| Native library mount | Host imports `OmgAppSurface` from `@omg-dev/app` (`web/src/embedded.tsx`, built by `vite.lib.config.ts`) and renders it as a normal React subtree sharing the host's document | `NativeComputerSurface.tsx` and `ComputerDemoSurface` in `vibes` `apps/web` | Active, the integration the screenshot bug lives in. Same-document DOM slot contract (`data-lfg-host-slot`) lets the host portal real chrome into LFG's layout instead of floating over it. |

These are not redundant — the iframe path is what a cross-origin host or an
older embedder without a build-time dependency on this package needs; the
library path is what the first-party hosted product (`app.omg.dev`) uses for
a same-document, no-postMessage-latency mount. Keeping both is an intentional
capability, not accidental duplication.

### Axis 2 — chrome branch within `App.tsx`, once mounted (this repo)

`App.tsx`'s top-level render is one function with early-return gates and then
one four-way header/rail ladder. Enumerated by reading the component itself
(`web/src/App.tsx`, the `return (...)` starting ~line 7961):

| # | Branch | Guard | Renders | Host dock point when `embedded` |
| - | --- | --- | --- | --- |
| 1 | Loading / connecting | `loading` (before the gate ladder) | `inert` shell, "Connecting…" pill, no header at all | **None** — no slot exists yet |
| 2 | Onboarding | `showOnboarding` | `OnboardingFlow`, no header | N/A (standalone-only path; `!embedded` implied by product flow) |
| 3 | Identity gate | `!embedded && !identity && users.length` | `WhoAreYou` picker, no header | N/A (standalone-only; explicitly gated off when `embedded`) |
| 4 | Mobile Live header | `isMobile && tab === "live"` (`isMobile`: `max-width: 767px`) | Full welcome/activity header + island | `data-lfg-host-slot="header-actions"` ✅ (pre-existing) |
| 5 | Mobile secondary header | `embedded && isMobile`, `tab !== "live"` | Back-to-Live + bare slot island | `data-lfg-host-slot="header-actions"` ✅ (pre-existing, deliberately no `data-lfg-host-settings` — see below) |
| 6 | Generic / tablet header | `!isMobile && !liveDesktopWorkspace` — the band **`768px`–`1023px`**, or a narrower desktop window that never reached the wide-rail workspace | Brand/back island + Project/Manage/User/Ask/Pages island | **Was missing** ❌ → fixed in this change |
| 7 | Desktop rail workspace | `liveDesktopWorkspace` (`isWide`: `min-width: 1024px`, plus `workspaceVisible`) | No top header; `RailStage`'s aside owns chrome | `data-lfg-host-slot="rail-footer"` ✅ (pre-existing) |

Branches 1-3 are pre-mount/gate states that exist in both standalone and
hosted contexts; they render no header and therefore offer the host no dock
point by construction (there is nothing of LFG's own to attach to yet).
Branches 4-7 are the "real" shell and are exactly what the host's own nav
(`vibes` `GlobalNavIslandBar` / `GlobalNavRailBar`) is built to detect and
dock into.

### Combined with responsive/auth/error modes

Crossing both axes with the standard product modes gives the full enumerated
surface a reviewer would need to check for "does the pill look right here":

| Shell | Mounted via | Auth state | Breakpoint | Host chrome placement (in `vibes`) |
| --- | --- | --- | --- | --- |
| Standalone LFG (`localhost:8766`) | Neither (own header/rail) | N/A — local, no host | mobile / tablet / desktop | N/A — LFG is its own host |
| Hosted, signed out | `ComputerDemoShell` → `ComputerDemoSurface` → `OmgAppSurface` | Anonymous, seeded demo transcript | all | Vibes' own "Preview / Sign in here" overlay, **not** `GlobalNavIslandBar` — no Computer/Settings pill in this mode at all |
| Hosted, signed in, mobile Live | `NativeComputerSurface` → `OmgAppSurface` | Authenticated | `<768px`, `tab=live` | Docked into island (branch 4 slot) |
| Hosted, signed in, mobile secondary | same | Authenticated | `<768px`, other tab | Docked into island (branch 5 slot) |
| Hosted, signed in, tablet/narrow | same | Authenticated | `768-1023px` | **Was floating (no slot) → now docked** (branch 6 slot, this change) |
| Hosted, signed in, desktop wide | same | Authenticated | `>=1024px` | Docked into rail footer (branch 7 slot) |
| Hosted, signed in, pre-mount | same | Authenticated, `OmgAppSurface` chunk still loading (Suspense) or LFG's own `loading` gate active | any | No slot exists yet → host correctly floats transiently (see "Remaining risk") |
| Hosted, crashed | Vendor boundary caught, `ComputerDemoShell`'s crash detector fires | any | any | Falls back to the signed-out demo/claim UI, not the live pill |

Total *distinct, addressable* layout states in the native-mount hosted path:
**7** (the 7 rows of the second table, discounting standalone and the
iframe path which has no pill at all). One of those seven — tablet/narrow —
was rendering without the docking contract other six either have or
structurally don't need.

## Root cause of the screenshot

1. `vibes`' `GlobalNavIslandBar` (`apps/web/src/components/app/global-nav-island.tsx`)
   is the Computer+Settings pill. It calls `useLfgHostSlot("header-actions")`
   (`apps/web/src/components/app/lfg-host-slot.ts`), which does a
   `document.querySelector('[data-lfg-host-slot="header-actions"]')` kept
   live via `MutationObserver`.
2. If that query finds nothing, the component intentionally falls back to
   portaling its own `fixed inset-x-0 top-0 z-[65]` pill to `document.body` —
   this is the designed graceful-degradation path for hosts on an older
   `@omg-dev/app` pin that predates the slot at all.
3. LFG's own header ladder (table above) offered that slot in branches 4, 5,
   and 7, but not branch 6 — the 768-1023px band. A device or window in that
   band (tablet portrait, iPad split view, a resized embedded panel — the
   screenshot's status-bar icon cluster is consistent with an iPad, not a
   phone, at a width in this band) hit branch 6, found no slot, and the host
   fell back to the same "no slot exists" floating path an out-of-date pin
   would trigger — even on a fully current pin.
4. The fallback pill's visual language (`bg-background/80 backdrop-blur-xl`,
   fixed positioning independent of LFG's own layout) does not match LFG's
   `glass-island` chrome, and its fixed-to-viewport positioning is what let
   it sit over the status-bar area instead of clearing it the way a docked,
   flow-positioned island would.

This is an **accidental** gap, not an intentional host capability: nothing
about the 768-1023px band is meant to withhold docking — branches 4, 5, and 7
all support it, and branch 6 is functionally "branch 4/7's content at a size
where neither of their guards is true." The two systems' breakpoints already
agree (`vibes`: `768` / `1024`; LFG: `767` / `1024` — verified in both
`web/src/App.tsx`'s `useIsMobile`/`useIsWide` and `vibes` `apps/web/src/hooks/use-mobile.ts`),
so this was a coverage gap in one repo's header ladder, not a breakpoint
mismatch between the two repos.

## What was fixed

`web/src/App.tsx`, the generic/tablet header branch (~line 8140 pre-change):
added the same `<span data-lfg-host-slot="header-actions"
data-lfg-host-settings={hostSettingsInMenu ? "menu" : undefined} />` node the
mobile Live header already carries, in the same position ("host actions
first, our overflow menu last"), and wired `onOpenHostSettings` into that
branch's `PagesMenu` call so the host-settings-in-menu capability degrades
the same way here as it already does on mobile. No new component, no new
capability — this closes the one gap in an existing, otherwise-consistent
contract.

`test/embedded-host-slot-parity.test.ts` (new) pins all three
`header-actions` slot instances and the rail-footer slot, source-level (this
codebase's established pattern for `App.tsx` regressions — see
`test/pages-nav.test.ts`, `test/desktop-rail-switch-bar.test.ts` — since
`App.tsx` is not exercised by a DOM-rendering test harness). It asserts:
the count is exactly 3 (no future branch reintroduces a gap silently),
each slot is embedded-gated, and the two slots that mount a `PagesMenu`
(mobile Live and generic/tablet) carry the host-settings flag while the
back-button-only mobile secondary header correctly does not.

## Shared shell contract (what stays constant vs. what's allowed to vary)

Per the task's requirement to avoid URL/viewport/DOM-presence/display-name/
build-source guessing: the *only* signal the host contract uses is the typed,
explicit DOM marker `data-lfg-host-slot="<name>"` plus its sibling flag
attribute `data-lfg-host-settings`, both read via `useLfgHostSlot` /
`useLfgHostSettingsInMenu` in `vibes`. This already satisfies the
requirement — it is not a viewport check, not a URL parse, not a
`document.title`/display-name sniff, and not conditioned on a build
timestamp. What this change adds is coverage, not a new detection strategy.

- **Constant across every placement:** the pill's two actions (Computer,
  Settings), their icons (`Monitor`, `Settings` from `lucide-react`), their
  labels/`aria-label`s, the active-state treatment (`aria-current="page"` +
  brand-color capsule), and the host-settings capability negotiation
  (`data-lfg-host-settings`). This was already true — `GlobalNavIslandBar`
  and `GlobalNavRailBar` share `NavIslandItem`/tab definitions
  (`COMPUTER_GLOBAL_TABS` in `bottom-nav.tsx`) — this change does not touch
  it.
- **Allowed to vary by host capability:** *placement only* — docked into
  LFG's mobile header island, docked into LFG's desktop rail footer, or
  (only when no slot is offered at all) floating. Placement is selected by
  `globalNavPlacement(isDesktop)` plus live slot availability, never by
  guessing the surface from the URL or viewport alone — `isDesktop` picks a
  *request* ("try the rail"), and the live `useLfgHostSlot` result is the
  actual capability check that decides whether that request was honored.

## Build parity (`vite.config.ts` vs `vite.lib.config.ts`)

Both configs:
- read `FRONTEND_VERSION` from the same source (`ROOT_VERSION`, root
  `package.json`, not `web/package.json` — see both files' comments on why),
  via the identical `define: { __OMG_FRONTEND_VERSION__: ... }`, so the
  independent frontend/backend version diagnostics
  (`web/src/lib/version-diagnostics.ts`, the Settings "Frontend"/"Computer"
  rows) are untouched by this change and stay correct in both builds.
- were rebuilt after this change and both succeeded:
  `bun run build` (standalone, `web/dist/`) and `bun run build:lib`
  (library, `web/dist-lib/`, `dist-lib/index.js` + `styles.css` +
  `index.d.ts`) — see verification below.
- `embedded-lib-smoke.test.ts` (pre-existing) imports the just-built
  `dist-lib/index.js` and asserts `OmgAppSurface` still mounts a real router
  tree against a mock transport — this passed against the rebuilt library,
  which is the closest in-repo proxy for "the host can still consume this."

No changes were made to either config; the fix is confined to
`OmgAppSurface`'s own render tree (`App.tsx`), which both configs bundle from
the same source.

## Coordination notes (corrected)

The task brief referenced "routing fix merged in v0.2.12," "switch-bar task
9d8268a6," and "conversation model 152b735d." Checked against this repo and
`vibes`' git history:

- `9d8268a6` and `152b735d` are omg.dev **session ids**, not commit hashes —
  they do not resolve in either repository's git log.
- v0.2.12 (`b6def0c`) is the CLI-install/`@omg-dev/cli` rename
  (`0efb621`, "first-run installs the local control plane"), not a routing
  change; the changelog confirms this.
- The actual switch-bar fix is `a54099f` ("keep the desktop Chat/Bots switch
  bar visible after selecting a bot," #189), released as **v0.2.13**
  (`f63ae13`), which had landed on `origin/main` after this session started.
  This branch was fetched and rebased onto `f63ae13` before verification; the
  rebase applied cleanly with no conflicts (the switch-bar fix touches
  `RailStage`'s rail header ~line 12454, disjoint from the generic header at
  ~line 8140).
- The conversation-model change (session `152b735d`) has not merged to
  `origin/main` as of this writing and could not be checked for overlap by
  git history; it should be coordinated by session message if it also
  touches `App.tsx`'s header ladder or `PagesMenu`.

## Verification boundary

Confirmed by reading source in both repos (`lfg` at this worktree, rebased
onto `origin/main` `f63ae13`; `vibes` fetched to `origin/main` `f20ce05e`):
the slot contract, the three-repo-independent-breakpoint agreement, the
missing branch, and the fix. Confirmed by running:
`bun run typecheck` (web), `bun run build`, `bun run build:lib`, the new
`test/embedded-host-slot-parity.test.ts`, and the pre-existing
`test/pages-nav.test.ts`, `test/desktop-rail-switch-bar.test.ts`,
`test/artifact-session-navigation.test.ts`, and
`web/src/embedded-lib-smoke.test.ts` — all pass against the rebuilt library.

**Not verified**: an actual logged-in `app.omg.dev` session, in either a
browser at the 768-1023px width or an iPad, was not reachable from this
environment — no browser-automation tool was available (checked; none
found), and this repository does not hold hosted product credentials. The
root cause and fix are therefore verified at the source and build level, not
by reproducing the live pixel-for-pixel screenshot. The `vibes` pin
(`apps/web/package.json`) is currently `v0.2.11`; this fix ships to
production only after a new `@omg-dev/app` release is cut here and that pin
is bumped in `vibes` — that bump and the live check it would enable are
outside this repository's delivery boundary (`AGENTS.md`: hosted product
concerns belong to `vibes`).

## Remaining risk

- The pre-mount window (branch 1: `loading`, and the `OmgAppSurface` lazy
  chunk's own `Suspense` gap before it commits) has no slot by construction.
  A host will float transiently there on every load, on every breakpoint,
  independent of this fix. If that transient floating is itself visible and
  objectionable (vs. sub-second and unnoticed), the fix is on the `vibes`
  side — e.g. holding the pill hidden until first paint — not in this repo.
- This fix has not been released or pinned by `vibes` yet. Filing/coordinating
  that pin bump once a release is cut is a `vibes`-side follow-up.
