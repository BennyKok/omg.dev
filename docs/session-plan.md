Status: current (2026-11-10).

# Session plan

The plan is what a session's agent says it is doing: its to-do list and its
sub-agents. It answers "where is the agent" in a long session without reading
the transcript.

## Flow

```
agent harness (aisdk-session / codex-aisdk-session)
  └─ PlanTracker (src/session-plan.ts) ── writes ──> <data>/session-plans/<sid>.json
serve: live-ws polls the file (1 s, mtime-cached) ── `plan` frame ──> browser
browser: @omg-dev/client caches it and replays it to late listeners
         components/session-plan.tsx shows it
```

The harness owns the plan. serve only reads it. The file outlives the
harness, so a finished or restarted session still shows its last plan, and a
restarted harness continues from it.

## Sources

| Agent | Steps | Sub-agents |
| --- | --- | --- |
| Claude | `TodoWrite` (whole list), `TaskCreate` / `TaskUpdate` (one task) | `task_started`, `task_progress`, `task_updated`, `task_notification`; `Agent` tool calls |
| Codex | `todo_list` item (whole list, done flags) | none in the SDK |

Only the session's top-level calls make the plan; a sub-agent's own to-do
list is ignored. Codex only marks steps done or not, so the first open step is
shown as current while its turn runs.

Other agents: add a tracker method in `src/session-plan.ts` and call it from
the harness. ACP agents (Grok, Cursor, fx) send a standard `plan` update that
maps directly.

## Team

The pane also shows the omg child sessions a session started, and theirs, as
a tree (`web/src/lib/session-team.ts`). The source is the session list the
app already polls: each row has its parent, working flag, status and last
message. `sessionListRow` (src/commands/serve.ts) adds `plan`, a short
summary of the child's own plan (progress, current step, running
sub-agents), so each child shows its internal sub-agents too, with no
subscription per child. A tap on a member opens that session.

## Status (omg_panel)

An agent keeps a short status for the person with the `omg_panel` MCP tool:
a one-line headline, optional markdown, up to 8 key numbers (with a good,
warn or bad tone) and one chart (line or bar, up to 120 points). Each call
replaces the whole status; `clear: true` removes it.

```
omg_panel (src/commands/mcp.ts) ── PUT/DELETE /api/sessions/<id>/panel
  └─ src/session-panel.ts ── writes ──> <data>/session-panels/<sid>.json
live-ws + /api/sessions: readSessionView() = plan file + status file
```

- One writer: `src/session-panel.ts`. The harness never touches the status,
  and the panel module never touches the plan file. Readers fold the two
  together, so the `plan` frame carries `status` and the browser keeps one
  cache.
- Only the session itself can write its status: the route requires the
  `X-OMG-Session-ID` header to be the session in the path, and the tool takes
  no session argument.
- It is data, not HTML. The browser draws the numbers and the chart with its
  own components, so it matches the app in light and dark and runs no agent
  script. Input is validated and bounded (64 KB body, 4000 characters of
  text).
- The headline is also in the session list summary, so a parent's Team view
  shows each child's own headline instead of its last tool call.

## Needs you

The pane starts with the open questions (`omg_input`, `omg_ask_user`) of the
session's team, matched by session id or native id at any depth. The source
is the one questions feed (`web/src/components/ask-center.tsx`); the pane only
filters it. An option button answers in place; a question without options, or
a key request, opens the session that asked. The session's own questions are
not repeated: they already show in its chat. The header chip counts them.

## UI

- Header chip: questions waiting on you, "1/4", working agents, and the
  status headline (else the current step) on wide screens while the pane is
  closed.
- Order: Needs you, Status, steps, Team, sub-agents.
- Phone: swipe left on the chat (or tap the chip) to open the plan page. Swipe
  right, Back, or Escape closes it. Swipe right on the chat still goes back.
- Desktop: a pane on the right of the chat when the column is at least 48rem
  wide. The chip opens and closes it; the choice is remembered.
- Steps: one compact row each; the current one shows what the agent is doing.
- Sub-agents: running ones show their latest activity. Finished ones fold
  under "N finished"; a failed one shows why.
- The list is only ever the agent's. There is no way to add or edit a step.
  Tap a step for "Do this next", "Skip", or "Add a note": each is a plain
  message to the agent about that step, sent like a composer message (same
  identity and send mode).

## Tests

- `src/session-plan.test.ts`: the trackers and the store.
- `src/session-panel.test.ts`: status validation, the owner-only route, and
  the folded view.
- `src/live-ws-plan.test.ts`: current plan on subscribe, late joiners,
  changes, finished sessions.
- `packages/client/src/client.test.ts`: plan cache and replay.
- `web/src/components/session-plan.test.tsx`, `web/src/lib/swipe-back.test.ts`.
