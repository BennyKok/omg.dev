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

## Phase 2 shape (landed)

```
 /mcp, /mcp/computer, /mcp/executor
   |
   resolveCaller(req)          src/policy/caller.ts
   |  session from ?session= or x-omg-session-id
   |  rows with mcpTokenRequired must present x-omg-session-token
   |  token = HMAC(box secret, session id)   src/policy/session-token.ts
   |  role  = row.role, else owner
   v
   enforceRole(req, role, ns)  src/policy/mcp-filter.ts
   |  tools/list  -> blocked tools removed from the reply
   |  tools/call  -> blocked tool answered with an error result, never forwarded
   v
   the endpoint's own server or proxy
```

- Roles: `src/policy/roles.ts`, `PATHS.data/roles.json`. `owner` is built in.
  Rules use Executor's pattern grammar over `<server>.<tool>` ids
  (`omg.ship`, `computer.click`, `executor.execute`). Block beats allow;
  unmatched tools get the role's `defaultAction`.
- Session role: `ManagedSession.role`, set by `POST /api/sessions/new`
  (`role`) or `PATCH /api/sessions/:id/role`. Takes effect on the next call.
- Routes: `/api/roles` (GET, POST), `/api/roles/:id` (PATCH, DELETE),
  `/api/executor/api/<allowlisted>` forwards policies, tools, integrations
  and connections to Executor with the bearer injected.
- UI: Settings > Roles & tool access. Tabs: Roles (omg), Gateway policies
  (Executor, box-wide), Integrations (Executor UI in an iframe). The
  composer has no role picker: a new session takes its user's role.
- Views and members (landed): `role.views = { hide, hiddenPages }` turns off
  Settings > View switches and hides top-level pages for viewers in that role.
  Layout only; the box has no auth, so the MCP filter above stays the boundary.
  `live` and `settings` cannot be hidden. `role.members` is a roster email
  list; one email belongs to one role, unlisted emails are the owner. This is
  the field vibes sync will write into. `GET /api/me?user=&role=` resolves
  the browser's pick (`lfg_user`) to `{ role, views, hide, hiddenPages }`;
  an owner may pass `role=` to preview. A new session with no explicit `role`
  takes the tagged user's role. The owner previews a role from a "Preview
  as" picker at the top of Roles & tool access. Settings > View greys out a
  switch the current role overrides and names the role. A member sees
  "Your role" there and cannot change it. There is no picker in the header.
- Executor policy API facts: payload needs `owner: "org"`; actions are
  `approve`, `require_approval`, `block`; DELETE takes a body with `owner`.

### Approvals in chat (landed)

A gateway policy of `require_approval` pauses a connector call. In this box's
`model` elicitation mode Executor would have the agent resolve that itself;
`src/executor/approvals.ts` takes it back:

```
 agent -> execute (gated tool)
   proxy sees waiting_for_interaction with an empty schema
   -> posts an omg ask (Approve / Deny) on the session, via POST /api/ask
   -> rewrites the reply: "wait, the owner was asked; do not resume"
   -> records executionId -> askId (in memory)
 agent -> resume(executionId)   refused while the ask is open
 human -> Approve / Deny on the ask card in chat
   -> omg calls Executor's REST resume with the daemon bearer
   -> the outcome (or the refusal) is sent into the session as a message
```

The card is the existing ask surface (`web/src/components/ask-center.tsx`),
so no new UI: the approval is an ask with `Approve` / `Deny` options. Only an
interaction with an empty requested schema is treated as an approval; a real
form (fields requested) keeps Executor's own flow. In memory on purpose: a
serve restart drops the daemon's paused execution and this map together.

Known limit: role rules see `executor.execute`, not the integration behind it.
Per-integration restriction per role needs a per-role Executor instance
(deferred). Box-wide per-integration rules go in Gateway policies.

## Phase 3 shape (landed): filesystem sandbox

A role can require a filesystem sandbox for its sessions
(`src/sandbox/bwrap.ts`). `Role.sandbox` is `none` or `bwrap`; owner is always
`none`. `POST /api/sessions/new` reads the session role's sandbox and passes it
to the harness spawn.

```
 spawnManagedHarness(command, { sandbox: "bwrap", cwd, ... })
   sandboxCommand wraps command with bwrap:
     --ro-bind /usr /bin /sbin /lib* /etc /opt /nix   (system, read-only)
     --tmpfs <home>                                   (empty home)
     --ro-bind <omgRoot>                              (code, read-only)
     --tmpfs <omgRoot>/data                           (mask omg secrets)
     --ro-bind <bun dir>                              (runtime)
     --bind <worktree>                                (the one writable path)
     --unshare-user/pid/ipc/uts/cgroup                (network stays shared)
```

Applies to the process-supervised harnesses only (aisdk, codex-aisdk,
opencode, pi), whose model credentials arrive through the environment, which
bwrap passes through — so an empty home costs nothing and withholds the
owner's stored logins. Terminal-backed agents read their own credentials from
home and are not sandboxed; a `bwrap` request for one is logged and the
session runs unsandboxed rather than failing.

Verified on this box: inside the sandbox a command reads and writes its
worktree, cannot read a sibling path, reads the omg code tree, and cannot read
the masked omg data dir (the session-token secret and the Executor bearer).

### Network egress allowlist (landed: best-effort layer)

A role's `network` is `shared` or `allowlist`, with `allowHosts` (owner is
always `shared`). An allowlist session's harness is pointed at the box's egress
proxy (`src/sandbox/egress-proxy.ts`): a loopback HTTP CONNECT proxy that lets
it reach only the built-in model APIs plus the role's hosts, and refuses the
rest.

```
 harness (HTTP_PROXY=http://<sessionId>:<token>@127.0.0.1:<port>, NO_PROXY=loopback)
    | CONNECT api.anthropic.com:443   CONNECT pastebin.com:443
    v
 egress proxy   verify token -> role -> allow = model APIs + allowHosts
    |  allowed -> tunnel        denied -> 403        bad token -> 407
    v
 upstream (only allowlisted hosts)
```

- Caller identity is the same per-session token the MCP endpoints use, carried
  in the proxy credentials, so one proxy serves every session at its own
  role's allowlist.
- Loopback is in `NO_PROXY`, so the omg MCP endpoint is reached directly.
- Verified on this box: through the proxy, an allowlisted host tunnels (200), a
  non-allowlisted host is refused (403 / connection failed), and a bad token is
  407.

This is the best-effort layer: the SDKs honour `HTTP(S)_PROXY`, so ordinary
model and tool traffic is filtered and logged, but an agent that dials a raw IP
past the proxy env escapes it.

The proxy already denies a dialled raw IP that is not on the allowlist, so the
env-honouring path cannot exfiltrate to an arbitrary address through it.

Deliberately not done: the strict layer. `--unshare-net` plus nftables in the
namespace, allowing only this proxy, would close the raw-IP-past-the-env gap.

This layer is BLOCKED for local development on the current box and was not
written, to keep every landed piece testable here. Measured on this machine:

- `CapEff: 0` — no CAP_NET_ADMIN to program a firewall.
- No `nft`, `iptables`, `slirp4netns`, or `pasta` installed.
- Rootless network namespaces are denied: `unshare --user --net` fails with
  `/proc/self/uid_map: Operation not permitted`.
- `--unshare-net` also severs the host loopback that the egress proxy and the
  omg MCP endpoint listen on, so a working strict mode must additionally plumb
  those two back in (a veth pair + NAT, or slirp4netns/pasta).

So strict mode belongs where the box grants CAP_NET_ADMIN (or ships
slirp4netns/pasta) and must be verified there, not on this host. True
untrusted-code isolation stays with Firecracker in `vibes`.

## Native connectors and OAuth (landed)

The connector layer is omg's own, not Executor's (that wrapping was removed):

- `src/connectors/store.ts`: per-member connections. Owner is an omg member or
  the org sentinel; a session sees its member's own plus org-shared.
- `src/connectors/hub.ts`: omg is an MCP client to each connection, injecting
  the credential host-side.
- `src/connectors/mcp-endpoint.ts`: `/mcp/connectors`, the agent surface,
  scoped to the session's member, role-filtered, with an approval gate.
- `src/connectors/catalog.ts`: browse the integrations.sh catalog.

OAuth is owned by omg (`src/connectors/oauth-provider.ts`, `oauth-store.ts`):
the MCP spec's discovery → dynamic client registration → PKCE runs through the
SDK's `auth()`, tokens are stored encrypted (key derived from the box secret).
Verified live: Linear and Notion both dynamically registered and returned an
authorize URL with omg's callback as the redirect.

### Managed UI: the redirect base

The redirect_uri must be an origin the user's browser reaches and omg serves.

- Local / Tailscale: `oauthRedirectBase()` uses the browser's own origin, so
  the provider redirects back to the Tailscale URL and the browser hits
  `GET /api/connectors/oauth/callback`.
- Managed (hosted) UI: the hosted app passes `redirectBase` to
  `POST /api/connectors/:id/oauth/start` pointing at a hosted relay it owns.
  The provider redirects to that relay, which then calls
  `POST /api/connectors/oauth/callback` on the box with `{ code, state }` to
  finish. That relay lives in `vibes` (this repo only provides the box
  endpoints it calls); it is the one piece not testable from here.

## Out of scope for this repository

Login, invites, SSO, team and role storage. Those belong to `vibes`. This
repository consumes a signed member token and a role policy.
