# Persistent bot self-management

Persistent bots have three narrow omg.dev tools:

- `omg_create_owned_bot` creates a bot for the calling bot's assigned user.
- `omg_update_self` changes only the caller's name, persona, public description,
  declared capability labels, and avatar.
- `omg_list_owned_bots` lists other bots for the same user. It returns only a
  stable bot ID, name, public description, avatar, enabled/runtime status, and
  declared capability labels.

The tools do not accept an owner or current-bot ID. The server resolves the
calling live session, its `botId`, and its assigned user. It then checks that the
persisted bot owner is the same user. A bot cannot update a peer. Peer discovery
does not return persona instructions, transcripts, runtime contracts,
credentials, ownership controls, session IDs, or execution paths.

One assigned user can own at most 10 persistent bots. Disabled bots count. The
store performs the quota check and write in one synchronous commit section, so
concurrent create calls cannot take the same final slot.

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
