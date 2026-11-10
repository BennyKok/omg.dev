# Event hooks

Status: implemented in `src/events/` (2026-11-10).

An event hook does work only when something new appears. It checks a source
on a cron schedule with no model. It runs its action only for items it has not
seen before.

```
SOURCE  ──new events──►  BUS (src/events/bus.ts)  ──batch──►  ACTION
script                   first check: record only             session (start an agent)
github                   drop keys already seen               notify  (push only)
                         maxRunsPerHour                       command (script, events on stdin)
                         at most 20 events per batch
```

## Parts

- `types.ts`: the shared shapes. Sources and actions import only this file.
- `store.ts`: the only owner of `<data>/events/` (hooks, seen keys, log, state).
- `bus.ts`: the registries and the rules. It runs inside the auto-agent
  scheduler tick, so there is no new process, port or timer.
- `sources/`, `actions/`: one file for each kind. To add a kind, add a file and
  one line in the registry in `bus.ts`.

## Rules

- The first check of a new or changed source records what exists and fires nothing.
- The bus marks a batch as seen before the action runs (at most once).
- Items over the hourly limit or over the batch size wait for the next check.
- A failing source or action sets `lastError` and notifies the owner once.
- A GitHub item whose body contains `<!-- omg-agent -->` is skipped. The session
  action tells the agent to end its GitHub posts with that line, so a reply
  does not wake the agent again. `maxRunsPerHour` is the backstop.

## Security

- Scripts get a minimal environment: `PATH`, `HOME`, `LANG`, `USER`,
  `XDG_CONFIG_HOME`, `OMG_EVENT_HOOK_ID` and `OMG_EVENT_STATE_DIR`. They do not
  get the server's secrets. The GitHub source also passes `GH_*` variables to
  `gh`.
- Scripts have a 30 second limit and a 256 KB output limit.
- Event data reaches an action script on stdin, never on the command line.
- The session action gives events to the agent as fenced, untrusted data
  below the instruction.
- Bot callers cannot create, run or delete hooks. A hook would give a bot a shell.

## Agent tools

`omg_preview_event_source`, `omg_save_event_hook`, `omg_list_event_hooks`,
`omg_run_event_hook`, `omg_delete_event_hook`. HTTP: `/api/events/hooks`,
`/api/events/preview`, `/api/events`.
