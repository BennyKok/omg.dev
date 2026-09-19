# omg layers: Client, Cloud, Infra, and the outer API from any client

Status: implemented in this repository for the Client, runtime, and guest
proxy origin. Date: 2026-09-18. `vibes` owns injecting the owner's token on
`/cloud/api/cli/*` at the Infra guest proxy.

## Problem

A user on the iOS app can create a project folder on a Computer and let an
agent build it. Publishing that folder is an agent decision (`omg_deploy` /
`omg deploy`), not a button on the project or folder sheet.

The only deploy path in the system is `omg deploy` in the retired vibes CLI
(`@omg-dev/cli` 0.4.42). `packages/cli` 0.5.1 downloads that tarball on
demand. A fresh Computer never installs it. On a Computer, `omg` is a symlink
to `src/cli.ts` of this repository (vibes `agenttemplates/catalog.go`), so
`omg deploy` prints "Unknown command" there.

## What happened to the CLI

| Date | Event |
| --- | --- |
| 2026-07 to 08 | vibes publishes `@omg-dev/cli` 0.4.x. Verbs: `create`, `deploy`, `apps`, `env`, `login`, and `computer setup` / `connect`, which install and pair `lfg`. Outer CLI wraps the inner runtime. |
| 2026-08-20 | Product pivot: prompt-to-app builder retired in favour of the Computer. vibes `f20ce05e` stops publishing `@omg-dev/cli`. This repository `0efb621` takes the npm name at 0.5.0 and drops the hosted verbs. |
| 2026-08-21 | This repository `99be95b` adds the 0.4.42 tarball shim because `@omg-dev/apps` was never published. |
| 2026-08-23 | vibes MCP pivots "from apps to computers". Nothing in vibes calls the CLI after this. |

The layering idea was correct. The ownership flip was never finished.

## Layers

```
+---------------------------------------------------------------+
| omg Client   web/ mobile/ desktop/ packages/client  (this repo)|
|   what the user touches                                        |
+---------------------------------------------------------------+
| omg Cloud    auth.omg.dev backend.omg.dev            (vibes)   |
|   account, billing, machine registry, project registry         |
+---------------------------------------------------------------+
| omg Infra    apps/infra Go orchestrator              (vibes)   |
|   Computers (Firecracker) and Deploys (<slug>.omgs.app)        |
+---------------------------------------------------------------+
| omg runtime  src/ packages/cli  `omg serve`          (this repo)|
|   runs on a Computer or on the user's own box                  |
+---------------------------------------------------------------+
```

Rules:

- One binary, `omg`. Two layers inside it stay explicit. Outer verbs
  (`login`, `whoami`, `machines`, `apps`, `deploy`) talk to Cloud and Infra.
  Inner verbs (`serve`, `setup`, `computer ...`) run the local runtime.
- The outer layer is a library first, `packages/cloud`. The CLI, the web UI,
  the mobile app, and the agent tool all call the same functions.
- "Project" becomes a Cloud object: id, machine, folder, deployments, URL.
  Today it is only a `cwd` string in `src/repos-store.ts`.

## What Infra already has (verified in `~/.omg/vibes-main` at `10dc6dad`)

- Go: `POST /v1/deploys` from a snapshot id, plus `rollback`, `get`,
  `visibility`, `delete`. `apps/infra/internal/api/server.go` line 488.
- Control plane: `POST /api/cli/apps/deploy-source` in
  `control-plane/lib/cli-deploy.ts`. It stages a `files_only` snapshot and
  calls `projectDeploys.publishForUser`. This is the same function the
  dashboard and the iMessage "ship it" flow use. The file states: "There is
  deliberately no second deploy path."
- Dashboard: `publish-screen.tsx` polls `projectDeploys.getStatus`.

So Infra and Cloud can deploy today. Nothing on a Computer, a phone, or in
an agent can call them.

## Proposal

### 0. The whole outer API is inherited, not only deploy

Every outer verb is one function in `packages/cloud`, one runtime action in
`packages/protocol`, one CLI verb, and one MCP tool. The identity comes from
the runtime's credential source (section 3), so the same set is available:

| Surface | Local box | Cloud Computer |
| --- | --- | --- |
| `omg login` / `whoami` | user token from `credentials.json` | inherited from the binding, `login` is a no-op |
| `omg machines` | user's bindings | same account, same list |
| `omg apps` / `env` / `visibility` | user token | inherited |
| `omg deploy` | user token | inherited |
| `omg_*` MCP tools for the agent | same as above | same as above |

The runtime is the only place that knows where the credential comes from.
Nothing above it branches on local versus cloud. Deploy is the first verb
because it is the missing product loop. It is not a special case.

### 1. Deploy is a runtime action, not a CLI verb

Add one protocol action to `packages/protocol`:

```
deploy.start   { cwd, slug?, visibility? }  -> { deployId, slug }
deploy.status  { deployId }                 -> { phase, url?, error? }
deploy.list    { cwd? }                     -> [{ slug, url, updatedAt }]
```

The server (`src/`) owns the action. It collects the folder the same way
`cli-deploy.ts` expects, posts to `deploy-source` with the account token,
and streams status. One owner. The CLI, web, mobile, and the agent tool are
thin callers.

### 2. Callers

The agent inside a Computer is a first class caller, equal to the user. It
reaches Cloud and Infra through the same `omg` binary that is already on its
PATH, and through the MCP tool that wraps the same library. So "deploy this"
in chat works without a human step, and every later outer verb (apps, env,
visibility, machines) reaches the agent for free.

| Caller | Change |
| --- | --- |
| `packages/cli` | `omg deploy` calls `deploy.start` on the local runtime. Delete `apps.ts` and the 0.4.42 tarball shim. |
| `web/` | Deploy button on a project. Status and URL card. |
| `mobile/` | Deploy row on the project sheet. Status, URL, open in browser. |
| MCP | `omg_deploy` tool so the agent can deploy when asked. Same library as the CLI. |
| agent shell | `omg deploy` works inside the Computer because `omg` there is this runtime. No extra install. |

### 3. Credential: two cases, one code path

The runtime never asks the user to `omg login` inside a Computer. The server
action always calls Cloud through one function, `cloudFetch(path, init)` in
`src/cloud-account.ts`. Only the credential source differs.

| Case | Where the runtime runs | Credential | Who attaches it |
| --- | --- | --- | --- |
| Local | user's own box, paired with `omg connect` | `~/.omg/credentials.json`, already read by `src/cloud-account.ts` | the runtime, as `Authorization: Bearer` |
| Cloud sandbox | Firecracker Computer | none on disk | Infra. The VM's outbound Cloud calls go through the node proxy, which knows the sandbox's binding and owner and adds the token on the way out |

Rules:

- The runtime does not branch on "am I in a sandbox" inside the deploy code.
  It calls `cloudFetch`. In the local case the token comes from the file. In
  the sandbox case there is no token, and the request goes to the Cloud
  origin the proxy rewrites. Detection lives in `cloud-account.ts` only.
- A sandbox never holds a long lived user token on its filesystem. The
  agent can read any file in the VM, so the token must stay outside it.
- The proxy scopes the injected token to the sandbox's own binding. Cloud
  rejects a call for a slug or machine the binding does not own.
- Same rule for every outer verb, not only deploy. `apps`, `env`, `machines`
  and `omg_*` MCP tools all ride the same function.

Owner: the proxy and its token scope are `vibes` (`apps/infra`). The single
call site is this repository.

### 4. Project registry

Second step, after deploy works. Cloud stores project -> machine -> folder ->
deploy slug. The mobile "New project" sheet creates the Cloud record and the
folder together.

## Out of scope

- Custom domains, env vars, rollback UI. The Go API has them. Add later.
- Changing how Computers are provisioned.

## Open questions

1. Which hop injects the token for a sandbox: the Go node proxy or the
   Cloudflare Worker? And which Cloud origin does the VM see for it?
2. Slug ownership: who picks the slug on first deploy, the user or the agent?
3. Does the Computer template pin (`v0.1.114` in `catalog.go`) get bumped
   with this release, so cloud Computers receive the action?

## First slice

Done in this repository:

1. Protocol types + server handler + focused tests against a fake control plane.
2. `omg deploy` / `omg apps` / `omg whoami` / `omg visibility` / `omg env` on
   the runtime CLI. The npm wrapper forwards those verbs to the install. The
   0.4.42 tarball shim is gone.
3. MCP tools `omg_deploy`, `omg_apps`, `omg_whoami`, `omg_app_visibility`.
4. `/api/repos` includes `deploy` from `.omg/project.json`.
5. A Cloud Computer with no token on disk uses `http://169.254.0.1:9090/cloud`
   so Infra can attach the owner's credential. `omg login` is a no-op there.


Still open:

- Custom domains, env UI, rollback. Infra has the APIs. Add later.
