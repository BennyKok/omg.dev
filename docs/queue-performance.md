# Queue performance benchmark

The queue benchmark measures the local control plane. It does not call an AI
provider. This keeps results repeatable and avoids model and network variance.

Run the default workload:

```bash
bun run bench:queue
```

Increase the stored rows and repeated samples:

```bash
bun run bench:queue -- --rows 2000 --iterations 1000
```

Save machine-readable results for comparison:

```bash
bun run bench:queue -- --json > queue-benchmark.json
```

The script uses a temporary SQLite database. It never opens `data/lfg.sqlite`.
It removes the temporary database when the run ends.

## Scenarios

- `sqlite_cold_open` opens SQLite and creates the queue schema.
- `sqlite_insert` writes one new durable queue row.
- `sqlite_status_update` persists one message status change.
- `sqlite_hydrate_warm` reads and decodes one complete session queue.
- `sqlite_hydrate_reopen` closes SQLite, reopens it, and hydrates the queue.
- `ui_reconcile_unique` folds a mixed queue snapshot into a large transcript.
- `ui_reconcile_repeated` measures the harder one-to-one matching case where
  many messages have the same text.

Each result includes p50, p95, p99, maximum latency, and operations per second.
Hydration and UI scenarios also report processed items per second in JSON.

## Compare results

Use the same machine, Bun version, row count, and iteration count. Close other
CPU-heavy work before each run. Run the benchmark at least three times. Compare
the median p50 and p95 values instead of one fastest result.

Do not use this benchmark to claim faster model responses. Provider startup,
network latency, tool execution, and model generation are outside its scope.
Measure those paths separately with opt-in live-provider tests.
