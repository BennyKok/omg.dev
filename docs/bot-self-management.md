# Persistent bot self-management

Persistent bots have four narrow omg.dev tools:

- `omg_create_owned_bot` creates a bot for the calling bot's assigned user.
- `omg_update_self` changes only the caller's name, persona, public description,
  declared capability labels, and avatar.
- `omg_list_owned_bots` lists other bots for the same user. It returns only a
  stable bot ID, name, public description, avatar, enabled/runtime status, and
  declared capability labels.
- `omg_send_message_to_peer` durably enqueues one message to a listed peer.
  The optional `replyToMessageId` makes an explicit, correlated reply.

The tools do not accept an owner or current-bot ID. The server resolves the
calling live session, its `botId`, and its assigned user. It then checks that the
persisted bot owner is the same user. A bot cannot update a peer. Peer discovery
does not return persona instructions, transcripts, runtime contracts,
credentials, ownership controls, session IDs, or execution paths.

Peer messaging accepts only a target bot ID, text, and optional reply message
ID. The server derives the sender bot ID and user from the authenticated live
runtime session. It rejects missing, disabled, and cross-owner targets. It
limits text to 8000 characters and each source bot to 10 accepted messages per
minute.

Each initial peer message gets a server-generated message ID and correlation
ID at depth 0. An explicit reply must refer to an accepted message delivered to
the caller from the selected target. The server copies the correlation and
increments depth. It rejects replies beyond depth 4. A bot must not start a new
correlation to evade this limit.

The target turn uses the existing persistent bot conversation and durable turn
queue. Sends to one target serialize in enqueue order. The event log and the
durable peer-message record contain stable sender, target, correlation, reply,
depth, and queue attribution. They do not log the message body.

The receiver gets an attributed envelope. Its ordinary assistant output stays
in its own conversation. The server does not forward model output and does not
create automatic replies. The receiver must call `omg_send_message_to_peer`
with `replyToMessageId` to send a reply.

## Conversation read state

Unread state belongs to a conversation, not to a bot or browser tab. The server
stores a read-through cursor in `data/bots/conversation-reads.json`. Its key is
the normalized assigned user and persistent session ID. A bot with two sessions
therefore has two independent watermarks.

Assistant output and an attributed `[Peer message from …]` turn are unread
activity. A human user turn is not. The Bots roster reads this state from
`GET /api/bots?user=<assigned-user>`. Selecting and displaying one conversation
calls `POST /api/bot-conversations/<session-id>/read`. The server rejects a read
for a different assigned user.

The client uses the existing transcript WebSocket to refresh unread state. If
the arriving turn belongs to the visible conversation, the client advances that
conversation watermark. Otherwise it only refreshes the roster. The normal bot
poll hydrates the same server state after reload, reconnect, or a change from
another tab or device. The v0.1.411 `bots` response field remains unchanged;
new clients also read the additive `conversations` field.

## Persistent-bot quota

One verified owner can store 20 persistent bots by default. Disabled and idle
bots count because the quota measures stored bot identities, not processes.
The store performs the count, quota check, and write in one synchronous commit
section. Concurrent create calls therefore cannot take the same final slot.

The server derives a managed caller from the host-stamped
`X-Omg-Viewer-Email` header. A request body cannot choose another Computer
member as the bot owner or consume that member's allowance. A local install has
no HTTP authentication layer. Its existing server roster validation remains
the local administrator boundary.

`GET /api/bots` and successful creates return an additive `quota` object with
`used`, `limit`, `remaining`, `scope`, and `source`. A refused create returns
HTTP 409 with `code: "bot_quota_limit"` and the same quota object.

The root-written `/etc/omg/computer-entitlement.json` contract can supply an
optional numeric `persistentBotLimit`. This is the only plan integration. The
runtime does not map plan names to guessed free, pro, or team values. Without
that field, a local administrator can set `LFG_PERSISTENT_BOT_LIMIT`; otherwise
the explicit default is 20.

Legacy bots that have no `owner` stay ownerless. The migration never guesses
ownership from a bot name, display name, session, or roster order. These bots
are reported in the grandfathered `legacy_pool` with a null limit. They remain
shared as before and do not consume any verified owner's allowance. Every new
managed create is stamped with the trusted caller, so the legacy pool does not
grow through the hosted API.

Four resource counts remain separate:

- The machine's total persistent bot records are the full `bots.json` list.
- A verified owner's allowance counts only records with that normalized owner.
- Sharing a Computer or a conversation changes access. It does not combine or
  transfer personal stored-bot allowances.
- Concurrent resident bot and agent runtimes use `maxLiveAgents`, the Computer
  admission entitlement, and the memory gate. They do not use this stored-bot
  quota.

A bot-created bot inherits the caller's approved execution workspace. The tool
does not accept a workspace path, so bot creation cannot expand filesystem
access.

Instruction changes persist in `data/bots/bots.json`. They set a durable runtime
refresh marker. The next message relaunches an idle bot with the updated contract
and the same conversation ID. If the current turn is still busy, the message is
rejected for retry. The server never changes a live prompt during a turn.

Bot identity and conversation identity do not depend on `cwd`. A human can move
a bot to another repository from the existing bot settings API. The repository
must be in the approved repo catalog. The next idle turn relaunches in that
workspace with the same bot ID, conversation ID, history, and instructions.

The current runtime grants one approved execution workspace per bot process. A
future multi-workspace bot must add an explicit persisted grant list and enforce
it at every filesystem/tool boundary. This change does not grant full-disk
access and does not treat system paths, credential folders, or unrelated data as
approved workspaces.
