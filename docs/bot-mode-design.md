# Bot Mode — design sketch

Status: exploration, not scheduled. Written 2026-08-15 after mapping the codebase
against two reference products: xAI's Grok Bot (launched 2026-08-11: always-on AI
teammates with their own cloud computer, group-chat coordination, routines learned
by demonstration) and Hermes Bot Mode (persistent named bots as an alternative to
sessions: one chat per bot, avatars, per-bot routines, bot-to-bot Agent Inbox,
@mentions — built as an orchestration layer over existing primitives, no core
patches).

## The concept

Today an omg.dev session is **task-scoped**: it is born from a prompt, works, ships,
and closes. A **bot** is **relationship-scoped**: a named, persistent agent with a
persona, one long-lived conversation, its own routines, and a presence in shared
channels. You don't "launch" it; you talk to it. It never ships-and-dies.

The bet, same as Hermes made: this is not a new agent runtime. It is a thin
persistence + routing + persona layer over the session engine we already have.

## What already exists (from the architecture survey)

| Bot-mode need | Existing primitive |
| --- | --- |
| Saved agent definition that isn't a session | `AutoAgent` in `src/auto/store.ts` (id, name, prompt, backend, model, thinking, tools, cwd, enabled) |
| Persona | `src/agent-profile.ts` profile directories (`system-prompt.md`, `skills/`, display name) — documented as backend-agnostic, wired only into `pi` today |
| System-prompt envelope | `omgRuntimeContract()` in `src/omg-capabilities.ts`, prepended at all 10 spawn sites in `src/tmux.ts` |
| Inbound message into a live conversation | ask-answer injection: `formatPushbackAnswerText` + `/send` with `mode: "steer"`; durable ordering via `mode: "queue"` + `src/sendq.ts` |
| Agent-to-agent messaging | subagent progress/terminal messages through the same `/send` route |
| Outbound to a human channel | `src/origin-deliveries.ts` + external adapters behind the relay (`omg_send_to_origin`; adapter owns transport, e.g. iMessage via Blooio) |
| Proactive events | `src/voice-bus.ts` fleet watcher (`subscribeFleet`), worked example in `src/session-push.ts` |
| Scheduled behavior | `src/auto/scheduler.ts` cron tick |
| Persona authoring UX | `src/auto/enhance.ts` compose/enhance/refine passes |
| Notifications | `src/push.ts` `notifyAll`, per-user filtering via `src/users.ts` |

What does **not** exist anywhere: channel/thread identity, mention parsing, group
membership, and a session that is allowed to live forever.

## Proposed shape

### 1. `Bot` record (`src/bots/store.ts`, sibling of `src/auto/store.ts`)

`AutoAgent` minus `schedule`, plus:

- `profileDir` — persona directory per `src/agent-profile.ts`
- `avatar` — the mascot: shape x colorway (see `web/src/components/BotAvatar.tsx`)
- `sessionId` — the durable managed session backing the bot's home chat
- `channels` — bindings: `{ channelId, policy: "mention" | "always" | "proactive" }`
- `routineIds` — auto agents owned by this bot (Hermes: routines are namespaced
  cron jobs; here they are plain `AutoAgent`s whose findings land in the bot's
  chat instead of the findings list)

Reuse `sanitizeThinkingLevel`, `claudeAccountForBackend`, and the compose/enhance
passes verbatim.

### 2. Conversational contract (`src/omg-capabilities.ts`)

Today's runtime contract is ship-or-die: finish verified work, `omg_ship`, close.
A bot needs a sibling envelope: you are `<name>`, this is your persona, you are in
an ongoing conversation, reply through your channel, speak only when addressed or
when your proactive policy fires, never close your session. Versioned the same way
(`OMG_CAPABILITY_VERSION`).

### 3. Durable bot sessions (`src/managed.ts`, `src/agent-admission.ts`)

- `spawnedBy: "bot"` — open string field, no schema change.
- `persistent: true` flag on the managed row: exempt from `src/idle-archive.ts`
  reaping and counted separately (or exempted) by the `maxLiveAgents` gate.
- `src/session-recovery.ts` already relaunches command-file sessions after a
  restart; bots ride that for free.

An idle bot costs nothing between turns — the session is a transcript plus a
command file, not a running process, until a message arrives.

### 4. Channel ingress (`src/commands/serve.ts`)

`POST /api/channels/:channel/messages` with `{ author, text, threadId?, mentions? }`:

1. Resolve channel → bound bots and policy.
2. Mention parsing (`@botname`) for `policy: "mention"` channels.
3. Format the turn with author attribution (the `formatPushbackAnswerText`
   pattern: `[Message from Benny in #general] ...`).
4. Deliver via the existing `sendPromptToLiveSession`, `mode: "queue"` for
   ordering under bursty group traffic.

Everything downstream — command file, sendq, transcript index, live WS — is
untouched.

### 5. Outbound (`src/origin-deliveries.ts`, `src/commands/connect.ts`)

Widen the delivery target from "this session's origin" to an explicit
channel/thread id, and add one `bot.message` event kind to the relay event plane
(the doc block at `src/commands/connect.ts:62-67` says new kinds need no relay
change). External adapters keep owning transport and identity, exactly per the
existing contract — omg.dev never sees phone numbers or tokens.

### 6. Bot-to-bot

The subagent `/send` mechanic already does attributed agent-to-agent messages.
Give every bot an "Agent Inbox" thread in its home chat (Hermes's design,
verbatim) and teach the protocol in the conversational contract. Grok-Bot-style
group coordination = several bots bound to one channel with `policy: "mention"`,
plus one coordinator bound `policy: "always"`.

### 7. Proactive policy (`src/bots/proactive.ts`)

A `subscribeFleet` subscriber per the `src/session-push.ts` worked example: on
events the bot cares about (build finished, finding filed, session blocked),
inject a system-authored turn into the bot's session — "this happened, decide
whether to say something" — and let the model decide. Timed proactivity is just a
routine.

### 8. Memory

The durable session transcript is short-term memory. Long-term: a `memory.md` in
the profile directory the bot may edit (the SOUL.md move), plus periodic
compaction. Cheap first version: a routine that summarizes the bot's own
transcript into its memory file.

## How it feels

- **Web app**: a Bots pane next to Sessions — roster with avatars and last-message
  previews. Tap a bot, land in its one persistent chat. Creating one is the
  auto-agent compose flow: one sentence → name, persona, avatar; a persona sheet
  instead of a cron field.
- **From your phone**: the iMessage adapter binds a channel to a bot. Texting it
  is texting that bot — same conversation, same memory, whether from iMessage or
  the web. This is the piece Grok Bot and Hermes both gate behind their own apps;
  we get it through the adapter seam with no new transport code.
- **Mentions**: `@researcher have a look at this` in a group thread wakes exactly
  that bot; it replies in-thread with attribution.
- **Routines**: "summarize my inbox every morning" lives on the bot and posts into
  the bot's chat, where you can reply "expand on the second one" — the reply is
  just a channel message into the same durable session. This closes the biggest
  gap of today's auto agents: they are one-shot and headless with a
  single-finding output and no reply channel.
- **Bots working together**: a coordinator bot in a group channel farms tasks out
  to sibling bots and to ordinary task sessions (which still ship-and-close —
  bots converse, sessions do heavy work; a bot spawning a session is just the
  existing subagent flow).

## Phasing

1. **Bot = persistent session + persona + web chat.** Store, conversational
   contract, `persistent` flag, Bots pane. No channel work — the web UI already
   sends. Shippable alone; this is Hermes-parity minus avatars-on-Telegram.
2. **Channel ingress + widened deliveries.** External adapters (iMessage first)
   bind channels to bots.
3. **Mentions, group threads, Agent Inbox.**
4. **Proactive policy + routines-into-chat.**

## Phase 1 implementation contract (agreed 2026-08-15, build target)

Scope: simple in-app chat. Channels (iMessage/Telegram) hook in later via the
adapter seam; nothing here may preclude that.

### Bot record — `src/bots/store.ts`, persisted to `data/bots/bots.json`

```ts
type Bot = {
  id: string            // "bot_" + short random id
  name: string
  shape?: BotShape      // mascot silhouette, the individual
  colorway?: BotColorway // mascot gradient, painted on the silhouette itself
  persona: string       // freeform persona / system prompt text
  agent: string         // harness key, default "aisdk"
  model?: string
  thinkingLevel?: string
  cwd?: string          // repo the bot operates in (defaults to server default repo)
  enabled: boolean
  sessionId?: string    // durable backing session, created lazily on first message
  createdAt: number
  lastMessageAt?: number
}
```

Follow `src/auto/store.ts` patterns (atomic write, validation via
`sanitizeThinkingLevel`, `claudeAccountForBackend`).

### HTTP routes (in `src/commands/serve.ts`, near the auto-agent block)

- `GET  /api/bots` → `{ bots: Bot[] }`
- `POST /api/bots` `{ name, persona, shape?, colorway?, agent?, model?, thinkingLevel?, cwd? }` → `{ bot }`
- `PATCH /api/bots/:id` (partial) → `{ bot }`
- `DELETE /api/bots/:id` → closes the backing session if live, removes the bot
- `POST /api/bots/:id/messages` `{ text }` → `{ sessionId }` — ensures the
  backing session exists (lazy launch), then delivers via
  `sendPromptToLiveSession` with `mode: "queue"`.

Chat history and streaming reuse the existing session transcript API and
`/api/live/ws` keyed by the bot's `sessionId`. No new read path.

### Backing session semantics

- Launched with a **conversational contract** (`botRuntimeContract()` beside
  `omgRuntimeContract()` in `src/omg-capabilities.ts`): named persona, ongoing
  conversation, reply in normal assistant messages, never `omg_ship`-and-close,
  never close the session.
- Managed row: `spawnedBy: "bot"`, new optional fields `botId` and
  `persistent: true`.
- `persistent` sessions are exempt from `src/idle-archive.ts` reaping and from
  the `maxLiveAgents` admission refusal (they still count toward display).
- If the backing session died (box restart etc.), the next message relaunches it
  with the same `botId` and the prior transcript summarized into the relaunch
  prompt (cheap continuity for phase 1).

### Bot-driven sessions in the sessions list

`Session` (read model in `src/sessions.ts`) gains `botId?: string` and
`botName?: string`, populated for (a) the bot's own backing session and (b) any
session whose `parentSessionId` chain reaches a bot's backing session (direct
children are enough for phase 1). The web sessions list renders a
"driven by <bot>" badge from these fields.

### Web UI (all in `web/`)

- **Bots tab** beside Sessions: roster rows (mascot avatar, name, last-message
  preview from the backing session transcript, relative timestamp), tap → chat.
- **Bot chat**: existing transcript view + composer, wired to
  `POST /api/bots/:id/messages`; live updates via the existing WS channel.
- **New bot sheet**: name, mascot (shape + colorway), persona textarea, advanced (agent, model,
  thinking, repo). Editing via the same sheet.
- **Sessions list**: the driven-by-bot badge.

## Open questions

- Cost/quota policy for `policy: "always"` bots in busy channels (per-bot rate
  limit? admission-gate budget?).
- Context growth in a never-closing session: when to compact, and whether
  compaction is the backend's (Claude auto-compaction) or ours.
- Multi-user channels have no authentication today (`src/users.ts` is a roster,
  not auth); fine for a single-tenant box, needs thought before shared channels.
- Whether bot routines reuse `Finding` dedupe/escalation or bypass findings
  entirely and just talk.
