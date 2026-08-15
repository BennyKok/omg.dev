import { mkdtempSync, rmSync, statSync } from "node:fs";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../src/config.ts";
import {
  readStoredQueue,
  resetSendQueueStoreConnectionForTests,
  writeStoredQueueMessage,
} from "../src/sendq-store.ts";
import type { QueuedMsg } from "../src/sendq.ts";
import {
  reconcileQueueMessages,
  type QueueMessageRow,
  type QueueReconcileMessage,
} from "../web/src/lib/queue-reconcile.ts";

type Options = {
  iterations: number;
  rows: number;
  json: boolean;
};

type Metric = {
  name: string;
  workload: string;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  operationsPerSecond: number;
  itemsPerSecond?: number;
};

type UiRow = QueueReconcileMessage & { sequence: number };

const DEFAULT_ITERATIONS = 250;
const DEFAULT_ROWS = 500;

function usage(): string {
  return `Usage: bun run bench:queue [options]

Options:
  --iterations <n>  Samples for read and UI scenarios (default: ${DEFAULT_ITERATIONS})
  --rows <n>        Queue rows used by storage scenarios (default: ${DEFAULT_ROWS})
  --json            Print machine-readable JSON only
  --help            Show this help`;
}

function positiveInteger(raw: string | undefined, flag: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    iterations: DEFAULT_ITERATIONS,
    rows: DEFAULT_ROWS,
    json: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--iterations") {
      options.iterations = positiveInteger(args[++index], arg);
      continue;
    }
    if (arg === "--rows") {
      options.rows = positiveInteger(args[++index], arg);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function metric(
  name: string,
  workload: string,
  samples: number[],
  itemsPerOperation?: number,
): Metric {
  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  const operationsPerSecond = totalMs > 0 ? samples.length * 1_000 / totalMs : 0;
  return {
    name,
    workload,
    samples: samples.length,
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted.at(-1) ?? 0),
    operationsPerSecond: round(operationsPerSecond),
    ...(itemsPerOperation == null
      ? {}
      : { itemsPerSecond: round(operationsPerSecond * itemsPerOperation) }),
  };
}

function sample(count: number, operation: (index: number) => void): number[] {
  const samples: number[] = [];
  for (let index = 0; index < count; index++) {
    const started = performance.now();
    operation(index);
    samples.push(performance.now() - started);
  }
  return samples;
}

function queueMessage(id: string, status: QueueMessageRow["status"], createdAt: number): QueueMessageRow {
  return {
    id,
    text: `queue message ${id}`,
    status,
    createdAt,
    updatedAt: createdAt,
    ...(status === "failed" ? { error: "benchmark failure" } : {}),
  };
}

function storedQueueMessage(id: string, status: QueuedMsg["status"], createdAt: number): QueuedMsg {
  return {
    id,
    text: `queue message ${id}`,
    status,
    attempts: status === "delivered" ? 1 : 0,
    createdAt,
    updatedAt: createdAt,
    ...(status === "failed" ? { error: "benchmark failure" } : {}),
  };
}

function uiHydration(item: QueueMessageRow): UiRow {
  return {
    id: `queue-${item.id}`,
    role: "user",
    kind: "text",
    text: item.text,
    ts: item.createdAt,
    sequence: -1,
    ...(item.status === "failed"
      ? { failed: true, queueError: item.error, queueId: item.id }
      : { pending: true, queued: item.status === "queued" }),
  };
}

function gitState(): { revision: string; dirty: boolean } {
  const revision = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const dirty = Bun.spawnSync(["git", "status", "--porcelain"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return {
    revision: revision.exitCode === 0 ? revision.stdout.toString().trim() : "unknown",
    dirty: dirty.exitCode === 0 && dirty.stdout.byteLength > 0,
  };
}

function printTable(metrics: Metric[]): void {
  const header = ["scenario", "p50 ms", "p95 ms", "p99 ms", "ops/s"];
  const rows = metrics.map((entry) => [
    entry.name,
    entry.p50Ms.toFixed(3),
    entry.p95Ms.toFixed(3),
    entry.p99Ms.toFixed(3),
    entry.operationsPerSecond.toFixed(1),
  ]);
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column]!.length))
  );
  const line = (row: string[]) => row
    .map((cell, column) => cell.padEnd(widths[column]!))
    .join("  ");
  console.log(line(header));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(line(row));
}

function run(options: Options) {
  const originalDataPath = PATHS.data;
  const benchmarkRoot = mkdtempSync(join(tmpdir(), "lfg-queue-benchmark-"));
  PATHS.data = benchmarkRoot;
  resetSendQueueStoreConnectionForTests();

  let checksum = 0;
  try {
    const metrics: Metric[] = [];
    const coldOpen = sample(1, () => {
      checksum += readStoredQueue("cold-open").length;
    });
    metrics.push(metric("sqlite_cold_open", "open database and create schema", coldOpen));

    const warmupRows = Math.min(50, options.rows);
    for (let index = 0; index < warmupRows; index++) {
      writeStoredQueueMessage("warmup", storedQueueMessage(`warmup-${index}`, "queued", index));
    }

    const sessionId = "benchmark-session";
    const createdAt = Date.now();
    const insert = sample(options.rows, (index) => {
      writeStoredQueueMessage(
        sessionId,
        storedQueueMessage(`row-${index}`, "queued", createdAt + index),
      );
    });
    metrics.push(metric("sqlite_insert", "one durable queue row", insert));

    const update = sample(options.rows, (index) => {
      writeStoredQueueMessage(
        sessionId,
        storedQueueMessage(`row-${index}`, "delivered", createdAt + index),
      );
    });
    metrics.push(metric("sqlite_status_update", "one durable status transition", update));

    for (let index = 0; index < 10; index++) checksum += readStoredQueue(sessionId).length;
    const warmHydrate = sample(options.iterations, () => {
      checksum += readStoredQueue(sessionId).length;
    });
    metrics.push(metric(
      "sqlite_hydrate_warm",
      `read and decode ${options.rows} rows`,
      warmHydrate,
      options.rows,
    ));

    const reopenSamples = Math.min(25, options.iterations);
    const restartHydrate = sample(reopenSamples, () => {
      resetSendQueueStoreConnectionForTests();
      checksum += readStoredQueue(sessionId).length;
    });
    metrics.push(metric(
      "sqlite_hydrate_reopen",
      `reopen database and read ${options.rows} rows`,
      restartHydrate,
      options.rows,
    ));

    const uiQueueRows = Math.min(100, options.rows);
    const uiHistoryRows = Math.max(1_000, options.rows * 4);
    const uiBaseTs = Date.now();
    const queue: QueueMessageRow[] = Array.from({ length: uiQueueRows }, (_, index) => {
      const status: QueueMessageRow["status"] =
        index % 4 === 0 ? "delivered" : index % 4 === 1 ? "queued" : index % 4 === 2 ? "failed" : "sending";
      return queueMessage(`ui-${index}`, status, uiBaseTs + index);
    });
    const history: UiRow[] = Array.from({ length: uiHistoryRows }, (_, index) => {
      const matched = index < Math.floor(uiQueueRows / 2);
      return {
        id: `history-${index}`,
        role: matched ? "user" : "assistant",
        kind: "text",
        text: matched ? queue[index]!.text : `history message ${index}`,
        ts: uiBaseTs + index,
        sequence: index,
      };
    });
    for (let index = 0; index < 10; index++) {
      checksum += reconcileQueueMessages(history, queue, uiHydration).length;
    }
    const uiUnique = sample(options.iterations, () => {
      checksum += reconcileQueueMessages(history, queue, uiHydration).length;
    });
    metrics.push(metric(
      "ui_reconcile_unique",
      `${uiHistoryRows} history rows and ${uiQueueRows} queue rows`,
      uiUnique,
      uiHistoryRows + uiQueueRows,
    ));

    const repeatedQueue = Array.from({ length: uiQueueRows }, (_, index): QueueMessageRow => ({
      ...queueMessage(`repeat-${index}`, index % 2 ? "queued" : "delivered", uiBaseTs + index),
      text: "same follow-up",
    }));
    const repeatedHistory = history.map((row, index): UiRow => index < Math.floor(uiQueueRows / 2)
      ? { ...row, role: "user", text: "same follow-up" }
      : row
    );
    for (let index = 0; index < 10; index++) {
      checksum += reconcileQueueMessages(repeatedHistory, repeatedQueue, uiHydration).length;
    }
    const uiRepeated = sample(options.iterations, () => {
      checksum += reconcileQueueMessages(repeatedHistory, repeatedQueue, uiHydration).length;
    });
    metrics.push(metric(
      "ui_reconcile_repeated",
      `${uiHistoryRows} history rows and ${uiQueueRows} identical queue rows`,
      uiRepeated,
      uiHistoryRows + uiQueueRows,
    ));

    const databasePath = join(benchmarkRoot, "lfg.sqlite");
    const git = gitState();
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runtime: {
        bun: Bun.version,
        platform: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0]?.model ?? "unknown",
        cpuCount: cpus().length,
      },
      git,
      config: options,
      databaseBytes: statSync(databasePath).size,
      checksum,
      metrics,
    };
  } finally {
    resetSendQueueStoreConnectionForTests();
    PATHS.data = originalDataPath;
    rmSync(benchmarkRoot, { recursive: true, force: true });
  }
}

try {
  const options = parseOptions(process.argv.slice(2));
  const result = run(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("Queue performance benchmark");
    console.log(`Bun ${result.runtime.bun} on ${result.runtime.platform} ${result.runtime.arch}`);
    console.log(`Git ${result.git.revision}${result.git.dirty ? " (dirty)" : ""}`);
    console.log(`Database rows: ${options.rows}; repeated samples: ${options.iterations}`);
    console.log("");
    printTable(result.metrics);
    console.log("");
    console.log("Use --json for machine-readable output. Compare runs on the same machine.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(1);
}
