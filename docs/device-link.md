# Device link

Status: phase 2 (core) and phase 3 (Settings, `@device` in the composer) implemented in `src/devices/` and `web/src/` (2026-11-10).

A device link lets an agent on this computer ask a linked device, such as a
test Mac, to do one action. The user approves the action on that device. The
device opens no port. It fetches requests over Tailscale and posts back the
results.

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

- Every grant has a hard expiry, 1 to 2 hours at most, and an idle timeout,
  15 minutes by default.
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
- `omg_list_devices` lists devices, their actions and recent requests.
- `omg_pair_device(name)` makes a pairing code. Only the person at the device
  can use it.
- In the web composer, `@` offers linked devices next to bots. Picking one
  inserts plain `@name` text. Settings lists devices, makes pairing codes and
  unlinks a device (phase 3). Approval stays on the device.

## Code

- `protocol.ts`: the wire contract and signing. Both sides import it.
- `store.ts`: the only owner of `<data>/devices/` (devices, requests, files, log).
- `http.ts`: `handleDeviceLink` (device calls, tailnet listener only) and
  `handleDevicesApi` (local API for agents and the UI).
- `agent.ts`: `omg device ...`, the device side and the pairing commands.

## Device config

`~/.omg-device/config.json` on the device. Example:

```json
{
  "grant": { "maxMinutes": 120, "idleMinutes": 15 },
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

- `argv[0]` must be an absolute path. Each value fills one argument and cannot
  start with `-` unless the rule has `"allowDash": true`.
- Every argument needs a `pattern` or an `enum`.
- An inner list is left out when an optional argument in it is missing.
- `{out}` is the request's output folder. Only plain files in it go back.
- Run `omg device check snap scene=home` to see the exact command.

## Setup

1. On the omg computer: `omg device pair test-mac`.
2. On the device: write the config, then run the printed
   `omg device link --server ... --code ...`.
3. On the device: `omg device run` starts a grant. Ctrl-C ends it.
4. To unlink: `omg device remove test-mac` on the omg computer, and
   `omg device unlink` on the device.

`omg serve` answers `/api/devices/link/*` on the main port and on the
`LFG_TAILNET_PORT` listener. Either can sit behind `tailscale serve`. On a box
that puts an identity proxy in front of the main port (this server: Caddy with
`tailscale whois`, service `lfg`), the device's tailnet user must pass that
proxy too, which adds a second check before the signature. Behind such a proxy
the server sees `127.0.0.1`, so the address pin is off.

## Known limits

- The agent that calls `omg_pair_device` sees the pairing code. Anyone who
  uses it first, within 10 minutes, links as that name. The real device then
  fails with "already linked", which shows the problem. Pair from the CLI when
  that matters.
- `once-per-grant` approves the action with any arguments for the rest of the
  grant. The prompt says so.
- The server forgets pairing codes and replay nonces on restart. A captured
  call could be replayed for up to 2 minutes after a restart, but only by
  someone who can already read the tailnet traffic.
