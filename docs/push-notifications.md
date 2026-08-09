# Push notifications

OMG sends Web Push itself — no Firebase, no APNs account, no npm push library.
Everything is Bun's WebCrypto: VAPID (RFC 8292) for authentication, aes128gcm
(RFC 8291) for the payload.

## What triggers a push

Five things, and only two of them are an agent's deliberate act:

| Trigger | Source | Agent-initiated |
| --- | --- | --- |
| A ship is accepted | `src/commands/serve.ts` (`/api/shipped`) | yes — `omg_ship` |
| A question is raised | `src/commands/serve.ts` (`/api/ask`) | yes — `omg_ask_user` / `omg_input` |
| A session finishes its turn | `src/session-push.ts` | no |
| An auto agent files a finding | `src/auto/runner.ts` | no |
| A frontend error is reported | `src/client-errors.ts` | no |

There is no "send me a notification" MCP tool. Agents raise notifications only
as a side effect of shipping or asking.

## How a notification reaches the device

The sender is always **your own `lfg serve` process**. It POSTs to the push
service the browser named (FCM, Mozilla, WebKit) — outbound only, so a
self-hosted box behind NAT needs no inbound port and no tunnel.

Two delivery shapes:

1. **Encrypted payload** (`src/push-encrypt.ts`) — the default. The notice is
   encrypted into the message with the subscription's own `p256dh`/`auth` keys.
   The receiving service worker renders it straight from `event.data.json()`.
2. **Payload-less wake** — the fallback for subscriptions stored before we
   captured those keys. The worker wakes and fetches the notice from
   `/api/push/pending`.

Shape 2 is same-origin by construction, which is why it is no longer the plan.

## Topologies

### Standalone `lfg serve` (and the hosted OMG sandbox)

UI and API share an origin, so both shapes work. Two things to watch on a
hosted sandbox:

- `data/push/vapid.json` must survive redeploys. The Dockerfile symlinks
  `/app/data` to the mounted volume (`/data/lfg`). Lose the volume and the
  keypair regenerates, and every existing subscription starts failing with
  `403` — logged by `sendOne`, but it presents to a user as "notifications
  just stopped".
- A hibernated sandbox sends nothing. Turn-completion pushes exist only because
  a live process is watching the fleet bus; there is no catch-up queue on wake.

### Self-hosted box + hosted UI

The browser is on the host's origin, so the service worker that receives the
push is the **host's**, not this repo's. Enrolment still works — the client
reaches `/api/push/vapid` and `/api/push/subscribe` through the host's
transport, and a subscription's `applicationServerKey` does not have to belong
to the page's origin — but a payload-less wake would have that worker fetch
`/api/push/pending` from the *host's* server, which knows nothing about your
box's queue.

The encrypted payload removes the callback, so this topology works. What the
host must do:

- **Render `event.data.json()`** in its service worker. The message is
  `{ title, body?, url?, tag?, requireInteraction? }`. Any worker following the
  usual Web Push convention already does this.
- Nothing else. No proxying of `/api/push/*`, no shared VAPID key, no access to
  the notification text — it is encrypted end to end between the box and the
  device.

Deep links are sent absolute, resolved against the `appBaseUrl` the device
recorded when it subscribed, so a worker on another origin still opens the
right app. `notificationclick` falls back to `openWindow` when `navigate()`
rejects a cross-origin target.

## Per-user targeting

`notifyAll({ user })` only reaches subscriptions bound to that user. A device
with no bound user does not catch another user's pushes.
