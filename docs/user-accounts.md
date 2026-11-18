# User accounts

Status: step 1 implemented in `src/tailnet-gate.ts` (2026-11-16), off by
default. Step 2 is not built. Step 3 is partly built: Settings > People &
roles has a People tab that shows each person and sets their role (2026-11-16,
`a2d1b4bf1`). The server does not yet enforce a role on each request, and the
tab does not add a person.

## Decision

omg.dev has no account system of its own. A team that shares one computer
uses Tailscale as its identity. A person is who Tailscale says they are.

This was chosen over built-in sign-in (passwords or passkeys) to keep the
system simple: no credential to store, no sign-in screen, no recovery flow.
Built-in sign-in can be added later for people who do not use Tailscale. It
is not planned now.

## How a request gets an identity

```
 on the computer itself ── LFG_PORT (loopback) ──────────> owner. No sign-in.

 from the tailnet ── tailscale serve ── LFG_TAILNET_PORT ─> the gate:
                                          │
                                          ├ Tailscale login on the user list ─> that person
                                          ├ Tailscale login not on the list ──> 403
                                          └ no login (tagged device, Funnel) ─> 401
```

- `tailscale serve` adds `Tailscale-User-Login` to each request it proxies.
- The login is trusted only on the `LFG_TAILNET_PORT` listener. That listener
  is loopback-only and is where `tailscale serve` points, so the header there
  comes from Tailscale. The main port never reads it.
- The user list is `LFG_USERS` plus the profiles made in setup
  (`rosterEmails()` in `src/users.ts`). The owner changes it on the computer.
  A change applies to the next request.
- The server keeps the admitted person with the request object itself
  (`tailnetPersonOf`). No header or query value from the caller can set it.

## Turn it on

On the computer, in the service environment:

```
LFG_TAILNET_PORT=8767
LFG_TAILNET_IDENTITY=1
```

Point `tailscale serve` at `LFG_TAILNET_PORT`. Without `LFG_TAILNET_IDENTITY`
the listener admits no person, as before.

## What step 1 does

- Admits a person by Tailscale login, and refuses every other login.
- `GET /api/me` answers for the Tailscale login and ignores the profile the
  browser sent. The answer carries `identity`.
- The web UI makes that login the browser's profile, so the "Who are you?"
  screen does not show for a known person.

## Not built yet

- Step 2: every route that takes a user from the query or the body uses the
  admitted person. Today only `/api/me` does. A person on the tailnet can
  still send another user's name to those routes.
- Step 3, remaining: a role enforced on the server for each request, and
  adding a person from the People tab. The People tab sets a role today. Roles
  already gate MCP tool access through `enforceRole` in
  `src/policy/mcp-filter.ts`, but that is not per-request enforcement of the
  admitted Tailscale person. The People tab is read-only apart from the role
  select.
- Not verified on a real tailnet: that `tailscale serve` replaces a
  `Tailscale-User-Login` header that the caller sent. The gate depends on
  this. Check it before you turn the switch on.
