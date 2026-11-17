# Device link

Status: core, controller Settings, and local receiver UI implemented in `src/devices/` and `web/src/` (2026-11-12). Session length, long sessions, Extend, the idle stop choice, agent extension requests and grant status for agents added 2026-11-17.

A device link lets an agent on this computer ask a linked device, such as a
test Mac, to do one action. The user approves the action on that device. The
device fetches requests over Tailscale and posts back the results. The CLI
opens no port. An instance running `omg serve` can use its existing localhost
UI to connect and approve. It adds no listener for incoming device commands.

The first user is the erase Mac tester (session `3ebc3cee`,
`erase-mac/tools/mac-tester/erase_tester.py`). Its requirements are below.

## Shape

```
 omg serve (this computer)                     linked device (`omg device`)
 ┌──────────────────────────────┐             ┌──────────────────────────────┐
 │ agent: omg_device_request(   │             │ no listening port            │
 │   "@bennys-mac", "snap", {…})│  1. poll    │                              │
 │            │                 │◄────────────│ 2. get the next request      │
 │            ▼                 │             │ 3. check it against the      │
 │ request queue (src/devices/) │             │    LOCAL action registry     │
 │ one owner: store + log       │             │ 4. grant or prompt:          │
 │                              │  5. result  │    [Allow once] [Allow 15m]  │
 │ result → agent as untrusted  │◄────────────│    [Deny]                    │
 │ data; files to device output │             │ 6. run as an argument list   │
 └──────────────────────────────┘             └──────────────────────────────┘
          only signed device calls reach the device handler
```

## Rules

These rules come from the first user's answers and from IR-2026-11-01.

### Network and identity

- The device connects out. It never listens. A strict macOS firewall (stealth
  mode, block all) does not need a change.
- Device calls use only `/api/devices/link/*`. Each one must carry a valid
  device signature, except pairing, which needs a one-use code. No other API
  route opens to the tailnet listener.
- Pairing makes an Ed25519 key pair on the device. The server stores only the
  public key. Every poll and every result is signed. The server also checks
  that the Tailscale address matches the paired device.
- Unpairing on either side, or `omg device stop` on the device, is the kill
  switch.

### Actions

- The action registry lives in the device's installed config. A repository
  that the device builds can never add or grant an action.
- Each action has typed, checked arguments. It runs as an argument list. There
  is no shell and no raw command.
- Code reaches the device only through git. It must be a commit that is an
  ancestor of `origin/main`, in a separate clone, never the user's checkout.
- Input actions (click, type, key) go only to one named app's window, and only
  while that window is in front.

### Approval

- Every grant has a hard end and an idle stop. The person at the device picks
  both in one decision when they start access: a session of 1, 4, 8, 12 or
  24 hours, and an idle stop of 15 minutes, 1 hour, 4 hours, or never while
  the session lasts. Without a choice, the defaults stay 120 minutes and
  15 minutes (`grant.maxMinutes` and `grant.idleMinutes` in the device config).
- A session longer than 4 hours is a long session. It needs an explicit
  choice at the device: a confirmation box in the UI, `--long` or a typed
  yes in `omg device run`. A remembered or default length never starts one
  silently, and `grant.maxMinutes` cannot be more than 240.
- While access is active, the person at the device can select Extend (1 hour,
  or 4 hours in a long session) and change the idle stop. Each decision can
  move the end to at most 4 hours after that decision (24 hours in a long
  session). `grant.hardMaxMinutes` in the device config lowers the long-session
  limit, for example `240` to forbid long sessions on that computer.
- Idle time does not count while an approved action runs. A 40-minute
  benchmark keeps the grant open until it ends, and the idle stop counts
  again from that moment. The hard end still stops a running action.
- An agent can ask for more time with `omg_device_extend`. The request
  appears on the device as an approval card ("Session abc12345 asks to extend
  access by 2 h") with a notification. Only the person there can allow or
  deny it. No answer means no: it lapses after 30 minutes, or when access
  ends, or after 2 minutes at an `omg device run` prompt. One request per
  device can wait at a time. An allowed extension follows the same limit as
  Extend.
- The device warns 10 minutes before access stops (by its end or by its idle
  stop) with a notification ("Access ends in 9 min"), and the card shows a
  live countdown. `omg device run` prints the same warning.
- Requests that expire while access is off are listed on the device ("2
  requests expired while access was off") until the person dismisses them.
  `omg device run` prints them at start. A request that the device fetched
  just as its grant ended is queued again, not left to expire.
- The device remembers the last length and idle stop in
  `~/.omg-device/state.json` and offers them next time. A long session must
  still be confirmed again.
- Each action has an approval level in the device config:
  - `in-grant`: allowed while a grant is active (for example `snap`,
    `app_shot`, `logs`, `test`, `status`).
  - `once-per-grant`: the first use asks (for example `sync` and `build`,
    because they run new code).
  - `each`: every request asks (for example `subs` and `trace`, which use real
    mail and the network, and `app_type`, which can type anything).
- The device asks for approval. The server never approves for the device. A
  phone cannot approve for another device until approvals are signed on the
  phone itself (a later phase).
- Receiver controls require a direct localhost UI request. They reject remote
  peers, forwarded requests, bot callers, and cross-origin mutations. The
  tailnet listener never exposes these routes. A controller cannot approve its
  own request through the signed link API.
- Stop ends pending approvals and kills the running action's process group.
  Grants do not resume after a restart. The CLI and UI share one receiver
  runtime and an exclusive lock in the device home.

### Why long sessions are safe enough

- The hard end and the idle stop limit how long an unattended computer
  accepts actions. They do not limit what an action can do. That stays with
  the action registry and its approval levels, which a longer session does not
  change: `once-per-grant` and `each` actions still ask.
- Only the person at the device can start, extend, or lengthen access. An
  agent's extension request is a question, not a grant: the controller stores
  it and shows it to the device, and the device changes its own grant only
  after a local Allow. A device cannot answer another device's request. The
  receiver routes accept only a direct localhost UI request (see Approval),
  and the CLI reads its choice from the device's own terminal. The controller
  and its agents cannot set the length, the idle stop, or the long-session
  choice.
- Each decision is bounded from the moment it is made (4 hours, or 24 hours
  for an explicit long session), so no chain of clicks or stale remembered
  setting leaves access open longer than the person chose at that time.
- Stop access, Stop and clear, Ctrl-C in `omg device run`, unlinking, and
  removing the device on the controller all still end access at once.

### Results and files

- Files move only from the device to the server: PNG, text and JSON, at most
  5 MB per file and 50 MB per grant. The device returns files only from its
  own output folder. It never accepts a path from the server.
- The device never sends tokens, keys or Keychain material.
- The agent receives results as fenced, untrusted data.
- The device logs every request and decision locally. The server logs them in
  `<data>/devices/`.

## Agent surface

- `omg_device_request(device, action, args, wait)` queues one request and
  waits up to `wait` seconds for `done`, `failed` or `denied`. A leading `@` in
  the device name is accepted.
- `omg_device_request_status(id, wait)` reads a request later.
- `omg_list_devices` lists devices, their actions, each device's `grant`
  and recent requests. `grant` comes from the device's signed heartbeat (every
  15 seconds while access is active, and once when it ends): `active`,
  `endsAt`, `minutesLeft`, `idleMinutes`, `idleMinutesLeft` (null while an
  action runs or with no idle stop), `busy`, a `summary` line, and a `hint`
  when access stops within 10 minutes. `omg_device_request` and
  `omg_device_request_status` return the same `grant`. A heartbeat older than
  60 seconds counts as no active access. It is shown to agents only; the
  server never uses it to decide anything for the device.
- `omg_device_extend(device, minutes, reason, wait)` asks the person at the
  device for more time and waits up to `wait` seconds for the answer. Pass
  `id` to check it later. Grant reports and extension requests live in the
  server's memory; a restart forgets them until the next heartbeat.
- `omg_pair_device(name)` makes a pairing code. Only the person at the device
  can use it.
- In the web composer, `@` offers linked devices next to bots. Picking one
  inserts plain `@name` text. Settings has two views: Use another computer
  (controller) and Share this computer (controlled instance). Approval stays
  on the device.

## Code

- `protocol.ts`: the wire contract and signing. Both sides import it.
- `store.ts`: the only owner of `<data>/devices/` (devices, requests, files, log).
- `http.ts`: `handleDeviceLink` (device calls, tailnet listener only) and
  `handleDevicesApi` (local API for agents and the UI).
- `agent.ts`: `omg device ...`, the device side and the pairing commands.
- `runtime.ts`: shared receiver lifecycle, pending approvals, and a bounded
  reader for the existing device audit log.
- `local-http.ts`: localhost-only receiver controls on the existing server.
- `lock.ts`: prevents a CLI and UI receiver from running at the same time.

## Device config

`~/.omg-device/config.json` on the device. Example:

```json
{
  "grant": { "maxMinutes": 120, "idleMinutes": 15, "hardMaxMinutes": 1440 },
  "actions": {
    "snap": {
      "approval": "in-grant",
      "argv": ["/Users/me/erase-tester/erase-mac/target/debug/erase-app",
               "--snap", "{out}/{scene}.png", "--scene", "{scene}",
               ["--theme", "{theme}"]],
      "args": { "scene": { "pattern": "[a-z0-9-]+" },
                "theme": { "enum": ["light", "dark"], "optional": true } },
      "timeoutSec": 300
    }
  }
}
```

- `grant` is optional. `maxMinutes` (1 to 240) and `idleMinutes` (0 means
  never) are the defaults when no choice is sent. `hardMaxMinutes` (1 to 1440,
  default 1440) is the most a long session may allow.
- `argv[0]` must be an absolute path. Each value fills one argument and cannot
  start with `-` unless the rule has `"allowDash": true`.
- Every argument needs a `pattern` or an `enum`.
- An inner list is left out when an optional argument in it is missing.
- `{out}` is the request's output folder. Only plain files in it go back.
- Run `omg device check snap scene=home` to see the exact command.

## Setup

With omg.dev running on both computers:

1. On the controller, open Settings → Agent access → Use another computer.
   Open Add a computer, enter a device name and select Get code.
2. On the receiving computer, open its own localhost UI. Select Agent access
   → Share this computer. Enter the controller's Tailscale HTTPS address and
   code, and select Connect.
3. Review the action permissions. The installed `~/.omg-device/config.json`
   is still required. Pairing does not start access or install actions.
4. Select a session length and an idle stop, and select Start access. For more
   than 4 hours, also select Allow a long session. While access is active, the
   card shows the time left. Select Extend 1 h to move the end, or change the
   idle stop there. Pending requests show the exact
   argument list. Select Allow once, Allow until access ends, or Deny as offered
   by that action's rule. No answer within two minutes means deny.
5. Enable device notifications in the receiving UI. Keep its local browser open.
   A new request appears across the app, even when access is stopped. Select
   View incoming requests to review it. A paired receiver opens this view by
   default. The active list shows queued work, approvals, running actions, and
   links to the requesting sessions on the controller.
6. Use Stop access to stop the grant. Stop and clear requests also cancels all
   open requests for this device on the controller. It preserves the audit log
   and coding sessions. If the controller cannot be reached, local access still
   stops and the UI reports that clearing failed. New requests can queue, but
   cannot run until access starts again. Disconnect removes the
   local key. Output appears as plain text.

The roles describe each link. The same instance can send requests to devices
and receive requests from its one paired controller. The receiver UI is not
available through a remote browser or a forwarding development proxy.

The CLI remains available:

1. On the omg computer: `omg device pair test-mac`.
2. On the device: write the config, then run the printed
   `omg device link --server ... --code ...`.
3. On the device: `omg device run` starts a grant. Ctrl-C ends it. Pass
   `--hours 8 --idle never` (or `--minutes`, and `--idle 15|60|240`). More
   than 4 hours needs `--long` or a typed yes. With no flags it offers the last
   choice. The CLI cannot extend a running grant; use the localhost UI for that.
4. To unlink: `omg device remove test-mac` on the omg computer, and
   `omg device unlink` on the device.

`omg serve` answers `/api/devices/link/*` on the main port and on the
`LFG_TAILNET_PORT` listener. Either can sit behind `tailscale serve`. On a box
that puts an identity proxy in front of the main port (this server: Caddy with
`tailscale whois`, service `lfg`), the device's tailnet user must pass that
proxy too, which adds a second check before the signature. Behind such a proxy
the server sees `127.0.0.1`, so the address pin is off.

## Known limits

- Update omg.dev on both computers for passive request lists and clearing.
  Deploying the controller does not update the receiving computer.
- Browser notifications need permission on the receiver. They use the local
  UI event stream and the existing app service worker. They work across pages
  and background tabs, but not while the browser is closed or suspended. OS
  notification settings can silence them. Notices contain no command arguments
  or session identifiers. Selecting one opens the local receiving page; it
  never approves the request.
- The UI can show work owned by a separate CLI receiver. That process still
  owns its approvals and grant. Stop it before taking control from the UI.

- After an unclean process exit, `~/.omg-device/run.lock` may remain. Verify
  that its PID is no longer running before removing the lock. Access never
  restarts automatically.
- Local activity shows the latest 50 records from a bounded tail of the audit
  log. Controller activity shows its latest 20 requests. Command output is
  available when the action finishes; it is not a live terminal stream.
- The agent that calls `omg_pair_device` sees the pairing code. Anyone who
  uses it first, within 10 minutes, links as that name. The real device then
  fails with "already linked", which shows the problem. Pair from the CLI when
  that matters.
- `once-per-grant` approves the action with any arguments for the rest of the
  grant. The prompt says so.
- The server forgets pairing codes and replay nonces on restart. A captured
  call could be replayed for up to 2 minutes after a restart, but only by
  someone who can already read the tailnet traffic.
