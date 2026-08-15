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
`structured_process_archive` sends the real command-file close shape, wakes the
command reader, waits for process exit, and removes the control files. An older
harness keeps its 250 ms polling fallback. A stuck harness still has a 300 ms
force-stop bound.

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
| Legacy tmux confirmed acceptance | 456.379 ms | 462.204 ms | 466.454 ms |
| Structured append and SQLite persistence | 0.290 ms | 0.381 ms | 3.555 ms |
| Structured harness acceptance | 123.530 ms | 230.978 ms | 241.069 ms |
| Legacy tmux start ready | 86.569 ms | 106.310 ms | 110.142 ms |
| Structured process start ready | 54.413 ms | 65.418 ms | 76.637 ms |
| Legacy tmux archive | 11.475 ms | 14.196 ms | 15.154 ms |
| Structured process archive | 4.654 ms | 6.419 ms | 8.115 ms |

The structured harness path was 3.694 times faster at p50 and 2.001 times
faster at p95. It saved 332.849 ms at p50 and 231.226 ms at p95.

The structured supervisor started 1.591 times faster at p50 and 1.625 times
faster at p95. These values stop at local control-plane readiness. They do not
include the SDK or ACP provider handshake.

Structured archive was 2.466 times faster than tmux at p50 and 2.212 times
faster at p95. It saved 6.821 ms at p50 and 7.777 ms at p95.

The first implementation waited for the full 300 ms grace period. Its
structured archive p50 was 300.474 ms. The wake and early-exit check reduced
that result to 4.654 ms. This is a 98.451% reduction and a 64.563 times speedup.
