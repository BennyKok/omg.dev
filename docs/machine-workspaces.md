# Machine workspaces: login and machine switching in the open source UI

Status: Block 1 implemented (`packages/cloud`). Blocks 2 and 3 proposed. Date: 2026-09-04. Owner: this repository (`web/`, `packages/`).

## Goal

Two building blocks, shared by the open source UI and the hosted product:

1. Sign in to omg Cloud from a local `omg serve` UI.
2. List the account's machines and switch between them. Each machine is a
   workspace, Slack style. Desktop gets an outer machine rail. Mobile gets a
   picker.

The hosted app (`BennyKok/vibes`) embeds the same code. It injects auth and
its own product chrome. It does not keep a second copy of the switcher.

## What exists today

Verified against `vibes` `origin/main` `789c800` (2026-09-04). The local
checkout at `~/repos/vibes` is four weeks stale, so all paths below are from
`origin/main`.

### Cloud side (vibes)

| Concern | Where | Shape |
| --- | --- | --- |
| Browser login | better-auth on `auth.omg.dev`, `POST /token {appId:"vibes"}` returns a JWT | cookie session, short lived JWT |
| CLI login | `packages/cli/src/auth.ts`, `config.ts` | OAuth 2.1 PKCE, stored in `~/.omg/credentials.json` |
| Machine list | `POST backend.omg.dev/api/computer/listComputerBindings`, `listSharedComputers`, `getCloudComputer`, `getOrProvisionCloudComputer` | Bearer JWT. Bindings come from the relay `/internal/bindings` |
| Selection | `api.computer.setComputerPreference` | binding id or `"cloud"` |
| Reaching a machine | `createGrantTransport({ baseUrl: "https://sessions.omgs.app", getGrant })` | grant from `POST /__omg/session-auth {bindingId, ownerUserId?}` |
| Transport cache | `apps/web/src/components/computer/computer-transport-cache.ts` | one transport per binding id |
| Binding model | `use-computer-state.ts` `ComputerBinding`, `computer-shared-binding.ts` `shared:<owner>:<binding>` | opaque id keys every cache |
| Picker UI | `computer-sheet.tsx` ("Run on") | cloud row, bindings, shared |
| Rail dock | `global-nav-rail.tsx` portals into `data-lfg-host-slot="rail-footer"` | host chrome inside LFG rail |
| Embed | `native-computer-surface.tsx` mounts `OmgAppSurface` with the cached transport for `bindingId` | switch = new transport prop |

### Native client (this repository, `mobile/src/omg`)

The mobile app already holds a framework light copy of the whole client side:

- `auth.ts`: better-auth sign in, `/token` mint, 30 s token cache.
- `provider.tsx`: bindings, shared, cloud state, selected binding, one
  `OmgClient` per binding through `getHostedTransport`, roster reset on switch.
- `computer-picker.ts`: option list for the picker (cloud, own, shared,
  blocked states).
- `config.ts`: `AUTH_ORIGIN`, `CONTROLPLANE_ORIGIN`, `SESSION_ORIGIN`,
  `CLOUD_BINDING_ID`.

This is the closest thing to a generalized package. It has no React DOM
dependency in the data layer.

### Local UI (this repository, `web/`)

- One module level transport: `createSameOriginTransport()` in
  `web/src/lib/omg-client.ts`. `configureOmgTransport()` swaps it and bumps
  `omgTransportGeneration()`. The counter exists for exactly this switch.
- `OmgAppSurface` (`web/src/embedded.tsx`) takes `transport` as a prop. The
  hosted app already switches machines by passing a new transport.
- `RailStage` in `web/src/App.tsx` owns the desktop rail and the
  `rail-footer` slot (line ~13178).
- `omg connect` stores the relay binding in `relay-credentials.json`.
  `serve.ts` exposes `POST /api/connect/reconcile`. There is no login concept
  in `serve.ts` or in `web/src`.

## Proposal

```
                    ┌──────────────────────────────┐
                    │ packages/cloud  (@omg-dev/cloud)│  data layer, no UI
                    │ auth · computers · grants ·    │
                    │ transport cache · selection    │
                    └───────┬──────────┬────────────┘
                            │          │
              ┌─────────────┴──┐   ┌───┴──────────────┐
              │ web/src         │   │ mobile/src/omg    │
              │ MachineProvider │   │ provider.tsx      │
              │ MachineRail     │   │ computer-picker   │
              │ MachineSheet    │   └───────────────────┘
              └───┬─────────┬──┘
                  │         │
      standalone  │         │ embedded (OmgAppSurface)
      omg serve   │         │
                  │         ▼
                  │   vibes apps/web: passes getAuthToken + chrome,
                  │   deletes computer-transport-cache, use-computer-state,
                  │   computer-sheet
                  ▼
      local box = first machine, cloud machines after sign in
```

### Block 1: `packages/cloud`

Lift from `mobile/src/omg` and the vibes `computer-*` libs:

- `auth`: `getSession`, `getAuthToken`, `signOut`. Endpoints configurable,
  defaults to `auth.omg.dev`.
- `computers`: `listBindings`, `listShared`, `getCloudComputer`,
  `resolveTarget` (from `computer-view-selection.ts`), `computerDisplayName`.
- `grant`: `mintSessionGrant` (from `computer-session-grant.ts`).
- `transports`: `getMachineTransport(bindingId)` cache (from
  `computer-transport-cache.ts`, without the vibes only observability).
- Types: `ComputerBinding`, `CloudComputerState`, shared binding id helpers.

Endpoints stay in vibes. Only the client moves. Mobile and vibes switch
their imports to the package.

### Block 2: machine workspace UI in `web/src`

- `MachineProvider` (`web/src/lib/machines.tsx`): the single owner of
  `{ machines, activeId, select }`. `machines[0]` is the local box on a
  standalone install. Cloud machines append after sign in.
- `select(id)` calls `configureOmgTransport(transportFor(id))`. Consumers
  that cache per machine data read `omgTransportGeneration()` and drop it on
  change. Audit the existing readers first; Settings' version row is one.
- `MachineRail`: outer rail on desktop, left of `RailStage`. Rendered only in
  the `liveDesktopWorkspace` branch. One icon per machine, plus add.
- `MachineSheet`: the mobile picker. Port of `computer-sheet.tsx`.
- Both render from `MachineProvider`. Hosted mode: vibes mounts
  `OmgAppSurface` with a new `machines` prop (`getAuthToken`, optional
  preloaded list). No `transport` prop needed once the surface owns the
  switch, but keep `transport` working for one release.

### Block 3: login on the local box

Reuse the OAuth 2.1 flow that `omg login` already runs against
`auth.omg.dev` (`vibes` `packages/cli/src/auth.ts`): dynamic client
registration, PKCE S256, public client, refresh tokens.

```
browser (local UI)          omg serve                 auth.omg.dev
  click Sign in  -------->  POST /api/cloud/login
                            register client + PKCE
                 <--------  { authorizeUrl }
  open authorizeUrl ------------------------------->  user signs in
                 <-------- redirect /api/cloud/callback?code=
                            exchange code ----------->
                            save ~/.omg/credentials.json
  GET /api/cloud/session -> { signedIn, user }
  POST /api/cloud/token  -> { token }   (refreshes silently)
```

- `serve.ts` owns the token. It reads and writes `~/.omg/credentials.json`,
  the same file `omg login` writes, so the CLI and the UI share one state.
- The browser never holds the account token. `getAuthToken` in the UI calls
  `POST /api/cloud/token` on the box. That getter is injected into
  `packages/cloud`, so vibes and mobile keep their own.
- Cross origin cookies to `auth.omg.dev` are not needed.

Risk: confirm that `auth.omg.dev` accepts a redirect URI other than
`127.0.0.1`, for example a Tailscale hostname. If not, the callback must
land on `127.0.0.1` on the box, which only works when the browser runs on the
same machine.

## Open questions

1. Local box identity. When signed in, the local box also appears in the cloud
   binding list. The rail must show it once. `omg connect status` reports the
   binding id, so `serve.ts` can expose it and `MachineProvider` can merge.
2. Route shape. Hosted uses `/computers/$bindingId`. Standalone has no such
   route. Decide whether the machine id lives in the URL or in local storage.
3. Per machine state leaks. `localStorage` keys such as `lfg_v2_user_filter`
   are origin scoped, not machine scoped. List and namespace them before
   shipping the switch.
4. `packages/cloud` depends on `@omg-dev/client` for `createGrantTransport`.
   Confirm the workspace build order in `scripts/test-builds.ts`.

## Suggested order

1. `packages/cloud` with tests. Done: `packages/cloud/src`, listed in
   `scripts/pack-packages.sh` and the release publish loop.
2. Mobile consumes it. No behavior change. Proves the extraction. Blocked
   until the package is published: `mobile/` installs `@omg-dev/*` from npm,
   not from the workspace.
3. `MachineProvider` + `MachineRail` + `MachineSheet` in `web/src`, standalone
   only, local box plus signed in cloud list.
4. `serve.ts` login broker endpoints.
5. Vibes swaps its copies for the package and the surface prop.
