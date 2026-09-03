# Team tooling: Executor, roles, sandbox

Status: phase 1 in progress. Decisions recorded 2026-09-02.

## Goal

One agent-facing tool endpoint per box. Team roles decide which tools a
session can see and call. Non-owner sessions run in a sandbox. Identity comes
from omg.dev (`vibes`). Compute, data, and connector credentials stay on the
box.

## Decisions

| Item | Decision |
|---|---|
| Connector gateway | One default [Executor](https://executor.sh) daemon per box, owned by `omg serve`. Not per role. |
| Executor bind | `127.0.0.1`, data under `PATHS.data/executor`, bearer token minted by omg. |
| Agent contract | Agents register `/mcp?session=<id>` (omg tools) and `/mcp/executor?session=<id>` (connectors). They never see the Executor token or port. |
| Identity | `identity.resolve(request) -> { member, role } \| owner`. `local-owner` today, `vibes` JWT verifier later. Solo box = owner, no filter. |
| Roles | User-defined in vibes. Role = name + policy. Cached on the box, max age 7 days, then deny. |
| Policy shape | `{ tools: string[], deny: string[], sandbox: "none" \| "bwrap" }`. Globs on tool names. |
| Enforcement | Filter `tools/list` and reject `tools/call` in the omg proxy. Both. |
| Session secret | Random token per session, `x-omg-session-token` header. Replaces trust in the bare `?session=` query. |
| Approval | Stays in the Executor UI. Linked from Settings. |
| Sandbox | bwrap. Opt-in per session first, then default for non-owner roles. |
| Dashboard | Settings shows a Connectors card: status, toggle, open dashboard. Opens `<origin>/?_token=<token>` in a new tab. |

## Phases

1. Executor lifecycle, `/mcp/executor` proxy, settings card. This document.
2. Session secret, identity interface, role policy filter.
3. bwrap sandbox profile per role.

## Phase 1 shape

```
 agent CLI
   |  /mcp?session=<id>            omg tools (existing)
   |  /mcp/executor?session=<id>   connector tools (new)
   v
 omg serve
   |  injects Authorization: Bearer <token>
   |  passes mcp-session-id both ways
   v
 executor daemon  127.0.0.1:<port>  EXECUTOR_DATA_DIR=PATHS.data/executor
```

Owner of the daemon: `src/executor/daemon.ts`. Same pattern as
`src/computer/desktop.ts`: pid and port on disk, adopt a healthy daemon after
a serve restart, reap a dead one.

Owner of the agent-facing endpoint: `src/executor/proxy.ts`. Transparent
HTTP proxy. No MCP client in omg, no schema conversion. The role filter in
phase 2 reads and rewrites the JSON-RPC bodies at this point.

Setting: `executorEnabled`, default `true`. When off, `/mcp/executor` answers
404, the same as `/mcp/computer` when disabled.

Binary: `executor` on `PATH`. Installed with `npm install -g executor` or
`bun install -g executor`. The package is about 280 MB unpacked. It is not a
dependency of this repository. Status reports `installed: false` with the
install command when it is missing.

## Executor facts verified 2026-09-02 (v1.6.7)

- `executor daemon run --foreground --hostname 127.0.0.1 --port <p> --auth-token <t>`
- `GET /api/health` returns `ok`.
- `POST /mcp` without a bearer returns 401. With the bearer it answers
  Streamable HTTP with `mcp-session-id`.
- Manifest at `<data>/server-control/server.json` with `pid`, `connection.origin`,
  `connection.auth.token`.
- Browser sign-in: `<origin>/?_token=<token>`.
- Env: `EXECUTOR_DATA_DIR`, `EXECUTOR_DISABLE_ANALYTICS`, `EXECUTOR_DISABLE_UPDATE_CHECK`.

## Out of scope for this repository

Login, invites, SSO, team and role storage. Those belong to `vibes`. This
repository consumes a signed member token and a role policy.
