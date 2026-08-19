# Bot-owned automations — implementation plan

Status: proposal, not yet scheduled. Written 2026-08-19, top-ranked item from the
xAI Grok Bot comparison pass. This is a plan document only — no code changes.

Companion to `docs/bot-mode-design.md` (the bot-mode design sketch this builds on).
Everything below was checked against the current code, not against that prior
research summary; file/line references are as of this writing and will drift.

## Benny's spec, restated as constraints

1. Build on the existing auto agent system (`src/auto/*`). No parallel scheduler.
2. A fired routine **notifies** the owning bot — it does not do the work itself.
   The bot does the checking, in its own persona/context, and replies in its own
   conversation.
3. Creating and deleting a bot's own schedule must be first-class, conversational,
   self-service, from inside the bot's chat.
4. Each bot has a max schedule count, sensible default, configurable.
5. Every automation records who made it: the user, or which bot.
6. Ownership visible in the UI and queryable.

## 0. What already exists, verified

- `AutoAgent` (`src/auto/store.ts:25`) is a prompt + 5-field cron + backend
  config. `listAutoAgents`/`saveAutoAgent`/`deleteAutoAgent` are a flat JSON
  store (`data/auto/agents.json`), no ownership field of any kind today.
- `src/auto/scheduler.ts` ticks every 60s (`startAutoScheduler`), finds due
  agents, and calls `runAutoAgent` **sequentially** (comment at scheduler.ts:8-9:
  serialized because the AI-SDK runner does a global `process.chdir`).
- `runAutoAgent`/`runAutoAgentInner` (`src/auto/runner.ts:238-354`) is 100%
  headless: spins up a fresh read-only Claude session, asks it to emit at most
  one JSON `Finding`, stores it, pushes a notification. This is the path
  bot-owned automations must **not** use — it has no persona, no memory, no
  reply channel.
- The bot chat delivery path already has everything item 2 needs:
  - `ensureBotSession(bot, firstMessage?)` (serve.ts:2211-2345): finds the
    bot's live session, or cold-starts one (through `activationGate({kind:
    "bot"})`), launched with `botRuntimeContract(...)` plus the message riding
    in the launch prompt.
  - The live path (`POST /api/bots/:id/messages`, serve.ts:3640-3668) calls
    `sendPromptToLiveSession(session, attributed, { mode: "queue" })` — queue
    mode is exactly the "cannot interrupt a bot mid-reply" guarantee item 2
    asks for (comment at serve.ts:1890-1899 explains why queue, not steer, is
    load-bearing for a persistent session).
  - `reviveBotSessionForReport` (serve.ts:2366-2379) already handles "the
    bot's session isn't live" for agent-authored sends: it relaunches through
    `ensureBotSession` and rides the text in on the launch prompt. This is the
    exact shape of "what happens when the bot's session is not live" — nothing
    new needs inventing, it needs reusing.
- MCP tools proxy HTTP routes with **zero caller-identity enforcement** today
  (`src/commands/mcp.ts:1204-1330`): `omg_list_auto_agents` /
  `omg_save_auto_agent` / `omg_run_auto_agent` / `omg_delete_auto_agent` can
  read/edit/delete *any* auto agent, from *any* session — bot or not. A bot
  runs on the ordinary coding-agent harness (`botRuntimeContract` says so
  explicitly, omg-capabilities.ts:100-108) so it already has this full,
  unscoped tool catalog. Any ownership design must close this at the server,
  not just add new nicer tools next to the old ones — a bot could otherwise
  bypass the new tools entirely.
- Caller identity for MCP tools resolves via `OMG_SESSION_ID`
  (`callerSessionId()`, mcp.ts:264-266) for stdio, and an `AsyncLocalStorage`
  (`withCallerSession`, mcp.ts:235-241) for the shared HTTP MCP transport. This
  is ambient, not client-supplied — the right anchor for "which bot is
  calling," un-spoofable by tool arguments.
- `Session`/managed rows already carry `botId` (`src/managed.ts:55`,
  `src/sessions.ts:313`), populated by `ensureBotSession` at launch
  (serve.ts:2305). So "which bot owns this session" is a single lookup away
  from any session id.
- The "driven by &lt;bot&gt;" badge (`DrivenByBotBadge`, App.tsx:24025-24050) and
  its `BotDirectoryContext`/`OpenBotContext` (App.tsx:644-645) are already
  shipped UI plumbing for exactly this kind of ownership pill — reuse, don't
  reinvent.
- Push-on-reply is already generic: `src/session-push.ts` fires off any
  session's busy→idle edge, bot sessions included. A bot answering a routine
  nudge already gets a push notification for free; nothing to build there.

## 1. Data model changes

### `src/auto/store.ts`

Add one field, deliberately singular — it is creator, delivery target, and the
UI's ownership column all at once, on purpose (see "Design note" below):

```ts
export type AutoAgentOwner =
  | { kind: "user" }
  | { kind: "bot"; botId: string };

export type AutoAgent = {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  owner: AutoAgentOwner;   // NEW
  cwd?: string;
  agent?: AutoAgentBackend;
  claudeAccountId?: string;
  model?: string;
  thinkingLevel?: string;
  tools?: string[];
  lastRunAt?: number;
};
```

**Design note on why one field, not two.** The spec text says "created by the
user or a bot," which sounds like a creator/attribution field distinct from
"who gets notified." Collapsing them is deliberate: v1 has no use case where
those two differ (a bot always notifies itself; a human creating a routine
"for" a bot from the web UI is best modeled as the human picking `owner: bot
X` in the New Schedule sheet, identical in shape to the bot creating it
itself). One field, one meaning, no drift between "who owns it" and "who gets
pinged" — call this out in the PR description so it doesn't get reinvented
later as two fields that can disagree.

**Migration** (backward compatible, no downtime, matches the existing pattern
at store.ts:51-64 for `autoAgentEnabledForBackend`/`normalizeStoredAutoAgents`,
which is explicitly a *read* migration — "avoids rewriting the store during a
status read, and the next normal edit persists the value"):

```ts
export function normalizeStoredAutoAgents(agents: AutoAgent[]): AutoAgent[] {
  return agents.map((agent) => {
    let next = agent;
    if (!next.owner) next = { ...next, owner: { kind: "user" } };
    if (next.enabled !== autoAgentEnabledForBackend(next.enabled, next.agent))
      next = { ...next, enabled: false };
    return next;
  });
}
```

Every pre-existing row silently becomes `owner: { kind: "user" }` on next read,
persists on next `saveAutoAgent`/`deleteAutoAgent` write (both already
round-trip through `listAutoAgents()`). No script, no forced rewrite.

Add an owner-scoped delete, single owner of the AutoAgent collection stays
`auto/store.ts` (bots/store.ts must not reach into `agents.json` directly):

```ts
export async function deleteAutoAgentsOwnedByBot(botId: string): Promise<number> {
  const list = await listAutoAgents();
  const keep = list.filter((a) => !(a.owner.kind === "bot" && a.owner.botId === botId));
  await Bun.write(agentsPath(), JSON.stringify(keep, null, 2));
  scheduleWakeHooksPush();
  return list.length - keep.length;
}

export async function countAutoAgentsOwnedByBot(botId: string): Promise<number> {
  return (await listAutoAgents()).filter(
    (a) => a.owner.kind === "bot" && a.owner.botId === botId,
  ).length;
}
```

### Cap: where it lives (`src/settings.ts`)

Follow the existing `maxLiveAgents` pattern exactly (settings.ts:10-93):

```ts
export type GlobalSettings = {
  // ...existing fields
  maxBotSchedules: number;   // NEW, per-bot cap, 1..BOT_SCHEDULE_LIMIT
};

export const BOT_SCHEDULE_LIMIT = 20;         // hard ceiling, like MAX_LIVE_AGENTS_LIMIT
export const DEFAULT_MAX_BOT_SCHEDULES = 5;   // see reasoning below
```

`sanitize()` gets the same clamp treatment as `maxLiveAgents`
(settings.ts:71-74): integer, `>= 1` (unlike live-agent count, 0-as-unlimited
makes no sense here — an unlimited bot is the exact failure mode item 4 exists
to prevent), clamped to `BOT_SCHEDULE_LIMIT`, default `5` on anything invalid.

**On the default of 5 vs. something else:** keeping Benny's 5. The actual
overwhelm risk isn't "5 vs. 8 schedules" — a single 5-minute cron on one
routine is worse than eight daily ones — so the cap's job is bounding *how
many concerns a bot is simultaneously tracking*, not primarily rate-limiting
(that's handled separately below by a minimum-interval floor). Framed that
way, 5 matches a normal working set (a morning check, an EOD summary, a
weekly report, one or two ad hoc watches) without needing the bot or the human
reviewing its Schedules pane to scroll. Global for v1 (one number for every
bot); per-bot override is a reasonable v2, noted and deferred, not built now.

This is a single global knob, not per-bot, for v1 — same scope as
`maxLiveAgents` today. `PATCH /api/settings` gains `maxBotSchedules`
(serve.ts:3169-3180 is the exact template: parse, range-check, `err(400, ...)`
on failure, store the patch), and the Settings panel in `web/src/App.tsx`
(the `maxLiveAgents` stepper around App.tsx:22311-22345) gets a twin control.

### Migration for existing auto agents with no owner

Covered above — it's the read-migration, not a script. No existing row
changes behavior: nothing sets `owner.kind === "bot"` until later PRs ship, so
this PR is a pure, inert, additive change.

## 2. Delivery path: how a fired routine reaches the bot's conversation

**Core idea:** the scheduler tick, on finding a bot-owned agent due, does not
call `runAutoAgent`. It builds an attributed nudge and delivers it through the
*exact same* machinery `POST /api/bots/:id/messages` already uses — same
queue-mode guarantee, same cold-start relaunch, one owner of "how a message
reaches a bot," not two.

### 2a. Extract the delivery primitive (`src/commands/serve.ts`)

The `/api/bots/:id/messages` handler (serve.ts:3640-3668) currently inlines:
resolve/attribute → `ensureBotSession` → `sendPromptToLiveSession` (if not
delivered on launch) → `updateBot(..., lastMessageAt)`. Pull the delivery half
(everything after attribution is built) into a named function in the same
file:

```ts
async function deliverBotMessage(
  bot: Bot,
  text: string,
): Promise<{ sessionId: string } | { error: string; status: number }> {
  const ensured = await ensureBotSession(bot, text);
  if (ensured instanceof Response) return { error: await ensured.text(), status: ensured.status };
  const { session, delivered } = ensured;
  if (!delivered) {
    const sent = sendPromptToLiveSession(session, text, { mode: "queue" });
    if (!sent.ok) return { error: sent.error || "failed to send bot message", status: 502 };
  }
  await updateBot(bot.id, { sessionId: session.sessionId ?? bot.sessionId, lastMessageAt: Date.now() });
  return { sessionId: session.sessionId! };
}
```

`POST /api/bots/:id/messages` becomes a thin wrapper around this (behavior
unchanged, verified by the existing bot-message tests). This is the one PR
that touches the human-chat path at all, and it's a pure refactor — no
behavior change, so it's safe to ship and verify in isolation before anything
about schedules exists.

### 2b. Wire the scheduler to call it, without a circular import

`serve.ts` imports `startAutoScheduler` from `src/auto/scheduler.ts` — so
`scheduler.ts` cannot import back from `serve.ts`. Use dependency injection,
module-level, matching the existing style in `scheduler.ts` (`timer`/`ticking`
are already module state):

```ts
// src/auto/scheduler.ts
export type BotRoutineDelivery = (agent: AutoAgent) => Promise<void>;
let deliverBotRoutine: BotRoutineDelivery = async (agent) => {
  console.error(`[auto-sched] no bot delivery wired for owner-bot agent ${agent.id}`);
};
export function setBotRoutineDelivery(fn: BotRoutineDelivery): void {
  deliverBotRoutine = fn;
}
```

`serve.ts`, once, near `startAutoScheduler(...)` (serve.ts:7456):

```ts
setBotRoutineDelivery(async (agent) => {
  if (agent.owner.kind !== "bot") return;
  const bot = await getBot(agent.owner.botId);
  if (!bot || !bot.enabled) {
    console.error(`[auto-sched] routine ${agent.id} owner bot ${agent.owner.botId} is gone or disabled — skipping`);
    return;
  }
  const text = routineNudgeText(agent);
  const result = await deliverBotMessage(bot, text);
  if ("error" in result) console.error(`[auto-sched] routine ${agent.id} delivery failed: ${result.error}`);
});
startAutoScheduler((l) => console.log(l));
```

Testable in isolation (matches the existing `wake-tick.test.ts` style: swap
`PATHS.data` to a tmp dir, dynamic-import, call `autoSchedulerTickNow`
directly with a mock installed via `setBotRoutineDelivery`).

### 2c. Nudge text and attribution (`src/auto/bot-routine.ts`, new, pure)

A routine nudge must be visually distinct from a human message so the bot
doesn't mistake a scheduled check-in for someone talking to it, mirroring the
existing `[Message from X to bot Y]` / `[Background task ...]` attribution
convention (serve.ts:1901-1926):

```ts
export function routineNudgeText(agent: AutoAgent): string {
  return `[Scheduled routine: ${agent.name}]\n\n${agent.prompt}`;
}
```

Kept as a pure, exported, one-line function specifically so it has its own
unit test independent of the scheduler/transport wiring.

### 2d. Fire-during-a-fire / sequencing subtlety

`scheduler.ts`'s per-tick loop `await`s `runAutoAgent` sequentially, and the
comment explains why: the headless runner does a global `process.chdir`, so
concurrent runs would race. Bot-routine delivery never touches `cwd` — it's
managed-session bookkeeping plus an HTTP-free function call. **Do not**
sequentially `await` it in the same loop as headless runs: `ensureBotSession`
may go through `activationGate` and cold-start a session (multi-second), and
serializing that behind it would delay unrelated headless auto-agents from
firing on schedule in the same minute. Dispatch it fire-and-forget from the
tick:

```ts
for (const a of agents) {
  if (!a.enabled || !a.schedule) continue;
  const due = mostRecentDue(a.schedule, now, tz);
  if (due === null || (a.lastRunAt && a.lastRunAt >= due)) continue;
  await setLastRun(a.id, now.getTime()).catch(() => {});   // stamp BEFORE dispatch either way
  if (a.owner.kind === "bot") {
    void deliverBotRoutine(a).catch((e) => onLog(`[auto-sched] ${a.id} delivery failed: ${e}`));
    continue;   // does not block the sequential headless loop below
  }
  onLog(`[auto-sched] firing ${a.id} (due ${new Date(due).toISOString()})`);
  try { await runAutoAgent(a, onLog); } catch (e) { onLog(`[auto-sched] ${a.id} failed: ${e}`); }
}
```

Stamping `lastRunAt` before dispatch, unconditionally, is load-bearing and
already the existing rule (scheduler.ts:118-119: "Stamp first so a crash
mid-run doesn't loop-retry the same instant") — it must also cover the
missing-bot and gate-failure cases in 2b, or a permanently-orphaned routine
retries every tick for the ~25h catch-up lookback window, spamming the log.

### 2e. What happens when the bot's session is not live

Nothing new: `ensureBotSession` inside `deliverBotMessage` already cold-starts
it — same path a human's first message or `reviveBotSessionForReport` uses.
The nudge rides in as the launch prompt (`ensureBotSession`'s `firstMessage`
param), so the bot's very first turn after a cold start answers the routine.
If `activationGate({ kind: "bot" })` refuses (box at `maxLiveAgents`, or
agents paused), `deliverBotMessage` returns an error, which is logged and
dropped for v1 — no finding, no retry storm (already covered by the
stamp-before-dispatch rule above), no push. Surfacing failed deliveries in the
UI is reasonable future work, not required for v1.

## 3. MCP tool surface

### Design decision: new bot-scoped tools, plus server-side enforcement on the old ones

Two things are needed together, not one instead of the other:

1. **New, minimal, self-service tools**, purpose-built for a bot's own
   schedules — no id-guessing, no cross-owner visibility by construction.
2. **Server-side ownership enforcement** on the *existing* generic tools
   (`omg_save_auto_agent`, `omg_delete_auto_agent`, `omg_run_auto_agent`,
   `omg_list_auto_agents`), because a bot already has those in its catalog
   today (§0) and could otherwise bypass the new tools entirely by using the
   old names. Both funnel through one authorization function server-side —
   single owner of the policy, per the repo's own "find the single owner"
   rule — so the guard can't be satisfied by one path and skipped by another.

### 3a. Threading caller identity to the HTTP layer

`mcp.ts`'s `api()` helper (mcp.ts:94-99) makes anonymous fetches today — the
server has no idea which session is calling. Add one header, set only by
`mcp.ts`'s own outgoing calls for the auto-agent tools:

```ts
// mcp.ts
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const sid = callerSessionId();
  const headers = { ...(init?.headers ?? {}), ...(sid ? { "X-Omg-Caller-Session-Id": sid } : {}) };
  ...
}
```

`serve.ts` reads it in the `/api/auto/agents*` handlers, resolves it to a
`botId` the same way §3c does, and treats "no header" as the human/browser
caller (unrestricted — the human stays admin over every automation, bot-owned
included; this is deliberate, not an oversight: item 5 asks for visibility and
control, and the human is the backstop if a bot mis-schedules itself). This
header is trusted at the same trust boundary as everything else on this local
API (no auth token anywhere on `/api/*` today) — not a new hole, just worth
naming in the risk section below.

### 3b. Authorization guard (`src/commands/serve.ts`)

```ts
async function assertCanModifyAutoAgent(
  agent: AutoAgent,
  callerBotId: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (callerBotId === null) return { ok: true };  // human/browser: full admin
  if (agent.owner.kind === "bot" && agent.owner.botId === callerBotId) return { ok: true };
  return { ok: false, status: 403, error: "not your automation" };
}
```

Applied in:
- `POST /api/auto/agents` (serve.ts:3767) when `b.id` is set (editing an
  existing row) — look up the existing row first, guard before saving. A
  **create** (no `id`) from a bot caller is forced to
  `owner: { kind: "bot", botId: callerBotId }` server-side regardless of any
  `owner` the request body claims — a bot can never mint a row owned by
  another bot or by "user".
- `DELETE /api/auto/agents/:id` (serve.ts:3907).
- `POST /api/auto/agents/:id/run` (serve.ts:3913) — and this handler must also
  branch on `agent.owner.kind`: for a bot-owned row, "run now" should deliver
  the nudge immediately via the same `deliverBotRoutine`, not call
  `runAutoAgent` (which would run the wrong, headless flow against a routine
  that was never meant to run standalone).
- `GET /api/auto/agents` stays unfiltered for the human/browser (unchanged);
  when called with a bot's caller header, filter to that bot's own rows only
  — this is what backs `omg_list_my_routines` below, and it means the same
  endpoint serves both the admin view and the self-service view correctly by
  construction.

### 3c. `callerBotId()` resolution (`src/commands/mcp.ts`)

```ts
type SessionRow = { /* existing fields */ botId?: string | null };

async function callerBotId(): Promise<string | null> {
  const sid = callerSessionId();
  if (!sid) return null;
  const { sessions } = await api<{ sessions: SessionRow[] }>("/api/sessions");
  const row = sessions.find((s) => s.sessionId === sid || s.nativeSessionId === sid);
  return row?.botId ?? null;
}
```

Purely ambient — never accepts a client-supplied override, so a bot cannot
claim to be a different bot by passing an argument.

### 3d. New tools (`src/commands/mcp.ts`, beside the existing auto-agent block)

```ts
server.registerTool("omg_list_my_routines", {
  title: "List My Scheduled Routines",
  description:
    "List the scheduled routines this bot owns — name, cron schedule, enabled state, last fired. " +
    "Only available inside a bot conversation. Call this before creating a new one so you know how " +
    "close you are to the cap.",
  inputSchema: {},
}, async () => {
  const botId = await callerBotId();
  if (!botId) throw new Error("omg_list_my_routines is only available inside a bot conversation.");
  const data = await api<{ agents: AutoAgent[] }>("/api/auto/agents"); // caller header scopes this
  return result({ routines: data.agents, cap: /* settings.maxBotSchedules, see below */ });
});

server.registerTool("omg_schedule_routine", {
  title: "Schedule A Routine For Myself",
  description:
    "Create a recurring check that nudges you, in this same conversation, on a cron schedule. " +
    "It does NOT run headless — when it fires, you get an attributed message here and do the " +
    "checking yourself, then reply normally. Only available inside a bot conversation. Capped per " +
    "bot; call omg_list_my_routines first if unsure how many you already have.",
  inputSchema: {
    name: z.string().min(1),
    prompt: z.string().min(1).describe("What you should check when this fires — written to yourself."),
    schedule: z.string().min(1).describe("5-field cron, box time zone."),
    enabled: z.boolean().optional(),
  },
}, async (input) => {
  const botId = await callerBotId();
  if (!botId) throw new Error("omg_schedule_routine is only available inside a bot conversation.");
  const data = await api<{ agent: AutoAgent }>("/api/auto/agents", {
    method: "POST",
    body: JSON.stringify({ ...input, owner: { kind: "bot", botId } }), // server re-forces this anyway
  });
  return result({ routine: data.agent });
});

server.registerTool("omg_unschedule_routine", {
  title: "Delete A Routine Of Mine",
  description: "Permanently delete one of your own scheduled routines. Only available inside a bot conversation.",
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => {
  const botId = await callerBotId();
  if (!botId) throw new Error("omg_unschedule_routine is only available inside a bot conversation.");
  await api(`/api/auto/agents/${encodeURIComponent(id)}`, { method: "DELETE" }); // 403s server-side if not caller's
  return result({ ok: true, deleted: id });
});
```

`omg_run_auto_agent`/`omg_list_auto_agents`/`omg_save_auto_agent`/
`omg_delete_auto_agent` stay as-is in name and shape (no breaking change for
existing task-session callers) — they simply start enforcing §3b underneath.

### 3e. What happens at the cap

`POST /api/auto/agents` create path, bot caller, checked before insert:

```ts
if (callerBotId) {
  const current = await countAutoAgentsOwnedByBot(callerBotId);
  const { maxBotSchedules } = await getGlobalSettings();
  if (current >= maxBotSchedules) {
    return err(409, `you already have ${current}/${maxBotSchedules} scheduled routines — delete one with omg_unschedule_routine before creating another`);
  }
}
```

The MCP tool surfaces this 409 body as the tool error text verbatim (the `api()`
helper already throws `new Error(data.error || ...)` on a non-OK response,
mcp.ts:97) — the model reads a directive, actionable message, not a bare
status code.

### 3f. Minimum-interval floor (also enforced at save time, same guard)

Cap alone doesn't stop one routine firing every minute. Reject a bot-owned
schedule (both create and edit) whose cron matches more often than a floor —
reuse `cronMatches` (scheduler.ts:72) to count matches over the next 24h and
reject above a threshold (e.g. more than 48/day, ~every 30 min average):

```ts
export function exceedsMaxFrequency(schedule: string, tz: string, maxPerDay = 48): boolean {
  let hits = 0;
  const start = Date.now();
  for (let m = 0; m < 24 * 60; m++) {
    if (cronMatches(schedule, new Date(start + m * 60_000), tz)) hits++;
    if (hits > maxPerDay) return true;
  }
  return false;
}
```

Applies only to `owner.kind === "bot"` rows — user-owned auto agents keep
today's unrestricted cron (that's existing, reviewed behavior; not in scope).

## 4. Bot runtime contract (`src/omg-capabilities.ts`)

`botRuntimeContract(name, persona, options)` gains a templated cap value and a
new block. Bump `OMG_CAPABILITY_VERSION`. Draft addition (inserted after the
existing "Anything bigger than that..." bullet, before the closing lines):

```
- You can schedule a recurring check on yourself with `omg_schedule_routine`,
  see your own schedules with `omg_list_my_routines`, and remove one with
  `omg_unschedule_routine`. You have at most ${maxBotSchedules} at a time —
  check `omg_list_my_routines` before creating another.
- A routine fires into THIS SAME conversation as a message starting with
  "[Scheduled routine: <name>]". Treat it like any other turn you'd have with
  yourself: do the check, reply in character. It is not a human and not an
  emergency — the same "chat turn, not investigation" rule applies; hand
  anything heavier than a couple of tool calls to a background session with
  `omg_create_subagent`, same as you would for a message from a person.
- Only schedule something with real recurring value — a daily or weekly check
  you would actually want to be nudged about. A one-off reminder is a plan you
  hold in the conversation, not a routine. Do not create a routine to remind
  yourself about something that already has one; check `omg_list_my_routines`
  first.
- Do not schedule something that fires more than a couple of times an hour —
  the box will reject anything past a fixed frequency ceiling.
```

`botRuntimeContract` needs the live `maxBotSchedules` value passed in (from
`getGlobalSettings()` at the call site, `ensureBotSession`, serve.ts:2280) so
the number in the prompt never drifts from the enforced number.

`OMG_CAPABILITIES` (the task-session table, omg-capabilities.ts:8-47) is
**not** touched — those three new tools are bot-only and would misinform a
task session into thinking it can call them. `omg-capabilities.test.ts:134`'s
snapshot of `OMG_CAPABILITIES` tool names stays unchanged; new tests instead
assert the bot contract contains `omg_schedule_routine` and the templated cap
number (mirroring the existing `botRuntimeContract` tests already in that
file).

## 5. UI

### Schedules page (`AutoManageView`, App.tsx:24666-…)

Each row (App.tsx:24722-24757 loop) gets an ownership pill next to the name,
generalizing the existing `DrivenByBotBadge` (App.tsx:24025-24050) rather than
writing a new component — same context (`BotDirectoryContext`/
`OpenBotContext`), same visual language:

```tsx
function AutoAgentOwnerBadge({ owner }: { owner: AutoAgentOwner }) {
  const directory = useContext(BotDirectoryContext);
  const openBot = useContext(OpenBotContext);
  if (owner.kind !== "bot") return null;
  const bot = directory.get(owner.botId);
  return (
    <button onClick={(e) => { e.stopPropagation(); openBot(owner.botId); }}
      className="flex shrink-0 items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20"
      title={bot ? `Owned by ${bot.name}` : "Owned by a deleted bot"}>
      <BotMascot shape={bot?.shape} colorway={bot?.colorway} size={14} state="idle" seed={owner.botId.length} />
      <span className="truncate">{bot?.name ?? "deleted bot"}</span>
    </button>
  );
}
```

A row with no `bot` match in the directory (owner bot deleted, but the row
somehow survived — shouldn't happen once §6's cascade PR ships, but the UI
should render sanely regardless) shows "deleted bot" rather than crashing.

`AgentEditorSheet` (App.tsx:21516) opened on a bot-owned row: keep it fully
editable by a human (they're always admin, §3b), but add a static "Managed by
&lt;bot name&gt;" line at the top so it's clear editing here doesn't stop the bot
from also managing it via chat.

### Bot chat header (App.tsx:15965-16064, the `headerBot` block)

Add a small pill next to the existing settings-gear button:
`Schedules (n/${cap})`, opening a lightweight sheet — a filtered
`AutoManageView`-style list scoped to `owner.botId === headerBot.id`, reusing
`AgentEditorSheet` for the detail/delete view. This is the "conversational,
self-service" surface made visible outside the chat transcript itself, for a
human skimming a bot's setup without having to scroll its history.

### Queryability

`GET /api/auto/agents` already returns the full `owner` field once §1 ships
(no separate endpoint needed) — "queryable" is satisfied by the existing list
endpoint plus the new bot-scoped filtering in §3b. `omg_list_my_routines` is
the query surface for bots; the Schedules page and the per-bot sheet are the
query surface for humans.

## 6. Staged PR sequence (smallest shippable first)

1. **Data model + migration only.** `src/auto/store.ts`: `owner` field,
   `normalizeStoredAutoAgents` backfill, `deleteAutoAgentsOwnedByBot`,
   `countAutoAgentsOwnedByBot`. `src/settings.ts`: `maxBotSchedules` +
   `DEFAULT_MAX_BOT_SCHEDULES`/`BOT_SCHEDULE_LIMIT`, sanitize, `PATCH
   /api/settings` support. Tests for the backfill and the sanitize clamp.
   **Zero behavior change** — nothing sets `owner.kind === "bot"` yet. Ships
   alone safely; unblocks everything after it.

2. **Delivery plumbing.** Extract `deliverBotMessage` in `serve.ts` (pure
   refactor of the existing `/api/bots/:id/messages` handler, same tests must
   still pass unmodified). `scheduler.ts`: `setBotRoutineDelivery`, the
   fire-and-forget branch in `autoSchedulerTickNow`, stamp-before-dispatch
   preserved. `src/auto/bot-routine.ts`: `routineNudgeText`,
   `exceedsMaxFrequency`, unit tests. Wire `setBotRoutineDelivery` from
   `serve.ts` at boot. No creation surface yet — verify via a test that
   directly saves an `owner: { kind: "bot", ... }` row and asserts the
   scheduler calls the injected delivery function instead of `runAutoAgent`.
   Inert until something can create a bot-owned row, so safe to ship early.

3. **Server-side ownership enforcement.** `X-Omg-Caller-Session-Id` header
   from `mcp.ts`'s `api()`. `assertCanModifyAutoAgent` guard wired into `POST
   /api/auto/agents`, `DELETE /api/auto/agents/:id`, `POST
   /api/auto/agents/:id/run` (including the run-now bot-owned branch). Cap and
   frequency-floor checks on the create path. This closes the "bot touches
   another automation" hole even before any bot has a reason to try — ship it
   defensively ahead of the tools that make it reachable.

4. **New bot-scoped MCP tools.** `omg_list_my_routines`,
   `omg_schedule_routine`, `omg_unschedule_routine` in `mcp.ts`, plus
   `callerBotId()`. First PR where a bot can actually self-serve create/list/
   delete end-to-end. Verify manually against a running bot conversation:
   schedule something, watch it fire and nudge, delete it.

5. **Bot runtime contract.** `botRuntimeContract` gains the scheduling block
   with the live cap templated in; `OMG_CAPABILITY_VERSION` bump. Pure prompt
   change, tests mirror the existing contract-content assertions in
   `omg-capabilities.test.ts`.

6. **Web UI.** `AutoAgentOwnerBadge` (generalized from `DrivenByBotBadge`) on
   the Schedules page; "Managed by &lt;bot&gt;" note in `AgentEditorSheet`; the
   `Schedules (n/cap)` pill + scoped sheet in the bot chat header; the
   `maxBotSchedules` stepper in the Settings panel.

7. **Bot-deletion cascade.** `DELETE /api/bots/:id` handler also calls
   `deleteAutoAgentsOwnedByBot(bot.id)` before/alongside `deleteBot(id)`.
   Web: confirm-dialog on deleting a bot with `n > 0` owned routines, naming
   the count. Isolated integration test: create bot, give it 2 routines,
   delete bot, assert both gone and the scheduler no longer fires them.

Each stage is independently shippable and independently verifiable; nothing
before stage 4 is user-visible, so stages 1-3 can land well ahead of any
announcement.

## 7. Risks and edge cases

- **Deleted bot with live routines.** Until stage 7 ships, or if a bot is
  deleted between scheduler ticks despite it, the fire path in §2b already
  tolerates a missing/disabled bot: skip, log, and — critically — still stamp
  `lastRunAt` (§2d) so it doesn't retry every minute for the ~25h catch-up
  window. Stage 7 makes this the rare case instead of the steady state by
  deleting owned routines at bot-delete time.
- **Cap lowered below current count.** Never destructive: existing rows over
  a newly-lowered cap keep running untouched. The cap only blocks *new*
  creations until the bot (or the human) deletes enough to get back under it.
  UI should mark an over-cap bot's schedule count visibly (e.g. "6/5") so a
  human notices without needing to be told.
- **A routine fires while the previous nudge is still unanswered.** Because
  delivery reuses `mode: "queue"` end-to-end, this is safe by construction —
  the new nudge waits its turn behind whatever the bot is doing, per the
  existing queue-mode guarantee (serve.ts:1890-1899). The more interesting
  case is a *backlog*: the same routine fires again before the bot ever
  replied to the last one (a stuck or long-idle bot). v1 answer: let nudges
  stack — a backlog of unanswered nudges is itself a legitimate signal ("you
  missed three days"), and building per-routine dedupe/collapse requires
  visibility into queue depth the system doesn't have yet. Note as v2, not
  built now.
- **Runaway self-scheduling.** Layered, not single-point: (a) per-bot cap,
  default 5, hard ceiling `BOT_SCHEDULE_LIMIT`; (b) minimum-interval floor at
  save time (§3f), independent of the cap, because a single too-frequent
  routine is worse than five reasonable ones; (c) `ownerBotId` is always
  forced server-side to the caller's own id — a bot can never create or edit a
  row that targets a different bot, closing the "spam a sibling bot" vector;
  (d) the runtime contract (§4) explicitly tells bots not to duplicate an
  existing routine and to check `omg_list_my_routines` first, reducing the
  chance of hitting the cap by accident rather than by intent.
- **Caller-identity header trust.** `X-Omg-Caller-Session-Id` is only ever set
  by `mcp.ts`'s own outgoing requests, but nothing stops another local process
  from forging it against the HTTP API directly. This is the existing trust
  model for the entire `/api/*` surface (no auth token anywhere today) — not a
  new hole introduced by this feature, but worth naming explicitly rather than
  assuming ownership enforcement is a real security boundary.
- **Slow bot cold-start delaying unrelated headless auto-agents.** Addressed
  in §2d by making bot-routine delivery fire-and-forget within the scheduler
  tick rather than sequentially `await`ed alongside `runAutoAgent` calls — get
  this wrong (await it in the main loop) and one stuck `activationGate` call
  delays every other due agent in that minute's tick.
- **A bot editing another bot's routine by guessing an id.** Closed by §3b:
  the guard checks the *existing* row's `owner`, not anything the request
  claims, before allowing an edit or delete — guessing an id gets a 403, not a
  silent no-op or a leak of the row's contents.

## Open questions (not blocking, flagging for follow-up)

- Per-bot cap override (v2) vs. today's single global number — revisit once
  real usage shows whether bots have meaningfully different needs.
- Whether a failed delivery (dead session, gate refused) should surface
  anywhere beyond the server log — a low-severity, non-`Finding` notification
  is a plausible v2, deliberately left out of v1 to avoid re-coupling this
  feature to the `Finding` lifecycle the spec explicitly says to bypass.
- Whether the human should be able to "assign" an existing user-owned
  schedule to a bot from the UI (flip `owner` after the fact) — not required
  by the spec, straightforward to add later since it's just another allowed
  `owner` transition under the same edit guard.
