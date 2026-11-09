Status: current (2026-11-09).

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

## UI

- Header chip: "1/4", running sub-agents, and the current step on wide
  screens while the pane is closed.
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
- `src/live-ws-plan.test.ts`: current plan on subscribe, late joiners,
  changes, finished sessions.
- `packages/client/src/client.test.ts`: plan cache and replay.
- `web/src/components/session-plan.test.tsx`, `web/src/lib/swipe-back.test.ts`.
