# Agent transport A/B benchmark

This benchmark compares the local message handoff before and after the SDK and
ACP migration. It uses deterministic local fake runtimes. It does not call an
AI provider or spend model tokens.

Run it with:

```bash
bun run bench:agent-transport
```

Save machine-readable results:

```bash
bun run bench:agent-transport -- --json > agent-transport-benchmark.json
```

Increase the number of messages in each path:

```bash
bun run bench:agent-transport -- --iterations 50
```

The script creates a temporary tmux session and a temporary data directory. It
removes both resources when the run ends. It never opens `data/lfg.sqlite`.

## Before path

`legacy_tmux_confirmed_accept` reproduces the unchanged confirmed-send loop from
the base commit. It clears the terminal composer, waits 120 ms, types through
tmux, polls every 150 ms until the text appears, submits, and polls again until
the text leaves the composer.

The fake TUI uses the real tmux server, pseudo-terminal, capture command, input
parser, and send-key functions. It removes provider startup and model variance.

## After path

`structured_request_persist` measures the synchronous request work. It appends
one JSON command and writes one durable queue row to SQLite.

`structured_harness_accept` continues until a separate harness process polls the
command file and parses the command. Its 250 ms poll interval matches
`managed-sdk-session.ts`. Deterministic jitter spreads messages across the poll
phase instead of measuring only its best or worst alignment.

## Lifecycle paths

`legacy_tmux_start_ready` creates a tmux session, pseudo-terminal, fake agent
process, and first visible composer. `structured_process_start_ready` starts the
same Bun helper as a detached process and waits for control-plane readiness.

`legacy_tmux_archive` kills the tmux session and confirms its removal.
`structured_process_archive` sends the real command-file close shape, honors the
production 300 ms grace period, waits for process exit, and removes the control
files.

These scenarios exclude real CLI loading, authentication, provider connection,
and transcript loading. They compare LFG's local supervisor overhead. A live
provider benchmark is required for actual ready-to-prompt latency.

## Scope

This benchmark measures LFG-to-runtime command acceptance. It does not measure
provider connection time, first-token latency, tool execution, network latency,
or complete turn duration. Those values need opt-in live-provider benchmarks
with fixed accounts, models, prompts, and repeated runs.

## Reference result

The first reference used three runs with 20 messages per path. It ran on Bun
1.3.14, tmux 3.6, and an eight-core Haswell Linux VM. Each value below is the
median result from the three runs.

| Scenario | p50 | p95 | p99 |
| --- | ---: | ---: | ---: |
| Legacy tmux confirmed acceptance | 457.475 ms | 462.536 ms | 463.673 ms |
| Structured append and SQLite persistence | 0.285 ms | 0.381 ms | 3.409 ms |
| Structured harness acceptance | 129.444 ms | 233.440 ms | 241.082 ms |
| Legacy tmux start ready | 86.310 ms | 98.754 ms | 109.902 ms |
| Structured process start ready | 57.229 ms | 70.251 ms | 79.806 ms |
| Legacy tmux archive | 11.273 ms | 13.475 ms | 14.886 ms |
| Structured process archive | 300.474 ms | 301.301 ms | 301.711 ms |

The structured harness path was 3.534 times faster at p50 and 1.980 times
faster at p95. It saved 328.031 ms at p50 and 228.573 ms at p95.

The structured supervisor started 1.532 times faster at p50 and 1.361 times
faster at p95. These values stop at local control-plane readiness. They do not
include the SDK or ACP provider handshake.

Structured archive was 26.652 times slower at p50. It added 289.185 ms. The
production close path's fixed 300 ms grace period causes almost all this cost.
