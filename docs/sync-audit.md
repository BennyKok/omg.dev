# Sync audit: one realtime layer for omg

Date: 2026-10-17. Sources: `origin/main` of this repository (`9cdf7085d`) and
of `vibes`, a signed-in production session on app.omg.dev, and
`scripts/sync-bench.ts` against this checkout.

## Summary

omg keeps clients in sync in four separate ways. Each one solves connect,
reconnect, resume, machine state, and scoping by itself. The results are
duplicate requests, two owners for the same state, and slow updates.

The Computer's own live channel is the base everything else stands on, and
its server polls. A title change takes 2 s to reach a client on the same
machine. An agent's new line takes 0.6 s. A line written while a client is
reconnecting is lost: the server answers `resumed` with nothing replayed.

Recommendation: make the open-source live protocol and client the one sync
layer, make the Computer push changes when they happen instead of polling,
and fix resume. Measure every step with `scripts/sync-bench.ts`.

## The four sync paths

| # | Path | Client | Transport | Owner of "what changed" |
|---|---|---|---|---|
| 1 | Computer ↔ web and iOS clients (this repo) | web `useLiveSocket` (own copy of the protocol); iOS and `@omg-dev/react` use `OmgLiveConnection` from `@omg-dev/client` | `/api/live/ws`, plus `/api/bootstrap` and polls | Server polls: status every 1 s from a 3 s session cache, transcripts every 1 s, drafts every 400 ms |
| 2 | Hosted wrapper around #1 (vibes `apps/web/src/components/computer`) | transport cache, grant owner, bootstrap readiness probe, presence lease, its own lifecycle read | proxies #1 through `sessions.omgs.app` | Control-plane lifecycle, read separately from the Computer's |
| 3 | Control plane ↔ dashboard (vibes) | TanStack Query with a 30 s poll on every query | REST, plus an SSE invalidation stream | Every write sends a collection name; the tab refetches whole query groups |
| 4 | Hosted user apps (vibes `@omg-dev/server` ↔ `@omg-dev/sdk`) | `SharedCollectionSocket`, one per URL | `/__vibes_sub` WebSocket | Event-driven: `notifyRowChange` on each write, scoped by `_owner` |

Paths 1 and 4 already use almost the same protocol: `subscribe` →
`snapshot`, then `delta`, with a `seq` per frame, a replay ring of 256, and
`resumed` / `gap` on reconnect. Path 4 pushes on write. Path 1 polls.

## Measurements

### Computer layer, local (sync-bench, three runs of 20 samples each)

Our own build on `127.0.0.1`, isolated `HOME`, no network in the path.

| Measure | Result | Cause |
|---|---|---|
| First `/api/bootstrap` | 1.25 to 1.48 s (warm: 24 ms) | cold session scan and caches on the first request |
| Socket open → first status frame | 3 ms → 4 ms | fine |
| Title change → status row on a client | p50 2.0 s, p95 2.9 to 3.0 s | status loop every 1 s reads a session list cached for 3 s (`LIST_SESSIONS_CACHE_TTL_MS`), on top of a 2.5 s process scan cache |
| Agent appends a transcript line → delta | p50 0.57 to 0.59 s, p95 0.71 s | per-transcript poll every 1 s |
| Reconnect with `resumeFromSeq` | `resumed` in 3 to 14 ms, `replayed: 0` | the line written while away is **never delivered** (see below) |
| Idle socket, 10 s | 0 frames | fine (server ping every 25 s) |

**Resume loses messages** (fixed in v0.6.254: the channel's replay ring is cleared when the server stops following a transcript, so a resume gets `gap` and a fresh snapshot; sync-bench now shows the missed line 9 ms after reconnect). When the last subscriber of a transcript leaves,
the server stops following that transcript. A line written meanwhile is not
in the replay ring. On reconnect the server replays the ring (empty) and
answers `resumed`, so the client believes it is current. The missed line
appears only after a full reload. Every client that resumes after a drop is
affected: a phone back from the background, a laptop waking, a brief network
loss.

### Computer layer, cloud sandbox (sync-bench on an `omg` template sandbox)

The same build, cloned onto a fresh sandbox and run there with
`scripts/sync-bench-sandbox.sh` (three runs of 20 samples each, sandbox
`5da52043f1bf`, deleted afterwards):

| Measure | Result |
|---|---|
| First `/api/bootstrap` | 586 to 732 ms (warm: 6 ms) |
| Title change → status row | p50 2.80 to 2.83 s, p95 2.93 to 2.95 s (v0.6.255: p95 41 to 55 ms, published on the session change instead of polled) |
| Transcript line → delta | p50 0.59 to 0.60 s, p95 0.70 s |
| Resume after a drop | `resumed`, `replayed: 0`, the missed line never arrives |
| Idle socket, 10 s | 0 frames |

The sandbox confirms the local results. The title delay is longer there.
The cause is not measured yet; the 1 s status tick and the 3 s session cache
are the likely reason.

### Production, one signed-in Computer page, 60 s

157 HTTP requests, not counting static files:

| Requests | What |
|---|---|
| 23 + 19 + 13 + 10 | control plane: `listSharedComputers`, `listComputerShares`, `installGuide/state`, `getMyProfile`, refetched by invalidation signals |
| 15 + 7 | analytics |
| 6 | Computer `threads` (about every 10 s) |
| 4 + 4 + 4 | `listComputerBindings`, `getCloudComputer`, `renewCloudComputerPresence` |
| 3 + 3 + 3 | Computer `install`, `server/stats`, CORS preflight for `install` |
| 1 each | `bootstrap`, `runtime-status`, then at 32 s a burst of `sessions`, `session-pins`, `auto/agents`, `auto/findings`, `repos` (the 30 s reconciliation cycle) |

One live socket carried 16 small frames in that minute.

The invalidation stream carried 407 signals in 20 s before the fix of
2026-10-17 (a dead Live Activity token looped the relay, and every user's
writes reached every user's tab). After it: 17, all from the signed-in
account.

## Duplicates and conflicts found

- **Two live clients for the Computer protocol.** The web app implements it
  in `web/src/useLiveSocket.ts`. iOS and `@omg-dev/react` use
  `OmgLiveConnection` in `packages/client`. Backoff differs (10 s cap and
  8 s cap) and so do reconnect rules.
- **Two readers of machine state.** The web app polls `/api/runtime-status`
  every 3 s while not live; the hosted wrapper reads the control-plane
  lifecycle separately. They disagree for seconds at a time (observed: the
  host said "paused" while the socket was live).
- **A third and fourth copy in vibes.** The dashboard has an unused copy of
  the `@omg-dev/server` subscription client (`subscribe.ts`), and
  `@omg-dev/sdk` has its own `SharedCollectionSocket`.
- **Polling on top of a live socket.** With the socket live, the web app
  still re-reads sessions, pins, auto agents, findings, and repos every 30 s,
  and iOS re-reads its session list every 10 to 60 s.
- **Status reaches everyone.** Status rows go to every open socket, whether
  or not it subscribed (`live-ws.ts`).

## Recommendation

1. **One protocol, defined once.** Move the live protocol types (subscribe,
   snapshot, delta, resumed, gap, status, ping) into `@omg-dev/protocol`. Its
   shape already matches `@omg-dev/server`'s subscriptions, so the hosted
   side can adopt the same definition.
2. **One client.** `OmgLiveConnection` in `@omg-dev/client` becomes the only
   client: web, iOS, `@omg-dev/react`, and later `@omg-dev/sdk`. The web
   app's own protocol code in `useLiveSocket.ts` goes away.
3. **Push, do not poll, on the Computer.** Publish a change at the moment it
   happens: a title or status change from the code that makes it, a
   transcript line from a file watch with a slow poll only as a safety net.
   Read status from the source, not from a 3 s cache.
4. **Fix resume.** Keep a cursor per transcript (byte offset or row id), not
   only a ring of frames. On resume, replay from the cursor, or send `gap`
   and a fresh snapshot. Never answer `resumed` when lines were missed.
5. **One owner of machine state.** The Computer connection reports live,
   connecting, waking, or failed. The hosted wrapper adds wake and
   authentication only. It stops reading a separate lifecycle to decide
   what the person sees.
6. **Delete the polls the socket makes redundant**, one at a time, each
   proven by the bench and by a request count.

## Targets for `scripts/sync-bench.ts` (local)

| Measure | Now | Target |
|---|---|---|
| Title change → status row, p95 | 2.9 s (v0.6.255: 44 to 73 ms) | under 100 ms |
| Transcript line → delta, p95 | 0.71 s (v0.6.257: 8 to 9 ms) | under 100 ms |
| Missed line delivered after resume | never | always, within 100 ms of `resumed` |
| First `/api/bootstrap` | 1.25 to 1.48 s | under 300 ms |

Run it with `bun scripts/sync-bench.ts --spawn` (add `--json` for machine
output), or on a fresh cloud sandbox with
`OMG_API_KEY=omg_sk_... scripts/sync-bench-sandbox.sh <branch> [runs]`. `--url` points it at a running Computer; the transcript and resume
checks then also need `--transcript-dir` and `--session` for a live session
you own.

## Not measured yet

- The same bench through the hosted path (browser → `sessions.omgs.app` →
  cloud Computer), which adds network and proxy time. A sandbox port opens
  only in the owner's signed-in browser, so this needs an authenticated
  browser client, not an API key.
- iOS client timings.
- Multi-client fan-out at scale (many sockets, many sessions).
