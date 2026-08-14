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
| Legacy tmux confirmed acceptance | 457.293 ms | 462.352 ms | 467.351 ms |
| Structured append and SQLite persistence | 0.271 ms | 0.442 ms | 3.370 ms |
| Structured harness acceptance | 130.459 ms | 233.070 ms | 240.834 ms |

The structured harness path was 3.511 times faster at p50 and 1.987 times
faster at p95. It saved 327.631 ms at p50 and 229.610 ms at p95.
