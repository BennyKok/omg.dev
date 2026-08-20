# Restart a persistent bot runtime

`Restart session` replaces the execution runtime for one persistent bot chat.
It does not create a new conversation.

The conversation remains the durable owner of these records:

- `conversationId`
- transcript and message history
- participants and message authors
- unread state
- queued messages

The old runtime session ID becomes archived history. A new runtime session ID
becomes the primary runtime for the same conversation.

## Safety

The server serializes restart work for each bot. It compares the runtime ID
that the client saw with the current primary runtime ID. A repeated request is
therefore a successful no-op after the first restart commits.

A restart does not stop an active turn. The server queues the restart when the
primary runtime is busy, when queued messages are pending, or when a delegated
child is active. The request runs at the next safe lifecycle boundary.

The server starts and attaches the replacement before it stops the old runtime.
If launch, attachment, persistence, or old-runtime shutdown fails, the server
keeps or restores the old primary binding and returns a typed error.

A dead runtime can restart immediately. A healthy runtime requires confirmation
in the user interface because restart discards process-local runtime state.

## Authorization

The server uses the verified Computer viewer and the existing bot control
policy. It does not accept a client-supplied user identity for restart access.
A verified Shared-Computer member can restart a bot chat that the member can
control under that policy.

## Boundaries

`Restart session` is available only in a persistent bot conversation.

It is not `Start fresh conversation`. Restart keeps the same durable
conversation and transcript.

It is not `Apply changes`. Apply changes exists because saved bot instructions
or runtime configuration are newer than the active runtime. Restart exists to
replace the runtime on demand. Both actions use the same rotation owner.

It is not `Stop`. Stop ends a task runtime. A persistent bot chat has no Stop
action in the chat interface.

It is not automatic compaction. Compaction rotates a bot when measured context
usage reaches the configured threshold. Restart is an explicit user action.

Regular task sessions and nested child task sessions do not expose this action.
Their existing UI and API contracts do not change.
