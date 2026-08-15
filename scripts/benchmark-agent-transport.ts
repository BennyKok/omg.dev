import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendCmd, cmdPath, removeEntry } from "../src/aisdk-registry.ts";
import { readNewCmdLines } from "../src/agents/backends/cmd-tail.ts";
import { PATHS } from "../src/config.ts";
import {
  resetSendQueueStoreConnectionForTests,
  writeStoredQueueMessage,
} from "../src/sendq-store.ts";
import {
  inputBoxText,
  tmuxClearInput,
  tmuxEnter,
  tmuxHasSession,
  tmuxType,
} from "../src/tmux.ts";

type Options = {
  iterations: number;
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
};

const DEFAULT_ITERATIONS = 20;
const LEGACY_CLEAR_DELAY_MS = 120;
const LEGACY_CONFIRM_POLL_MS = 150;
const STRUCTURED_COMMAND_POLL_MS = 250;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function helperArgument(name: string): number {
  return process.argv.indexOf(name);
}

async function runFakeTui(ackPath: string): Promise<never> {
  let draft = "";
  const input = process.stdin as NodeJS.ReadStream;
  input.setRawMode?.(true);
  input.resume();

  const render = () => {
    process.stdout.write(
      `\x1b[2J\x1b[Hlegacy transport benchmark\n────────────\n❯ ${draft}\n────────────\n`,
    );
  };
  render();

  input.on("data", (chunk: Buffer) => {
    for (const byte of chunk) {
      if (byte === 3) process.exit(0);
      if (byte === 13 || byte === 10) {
        if (draft) appendFileSync(ackPath, `${draft}\n`);
        draft = "";
        continue;
      }
      if (byte === 21) {
        draft = "";
        continue;
      }
      if (byte === 1 || byte === 11 || byte === 27) continue;
      if (byte >= 32 && byte <= 126) draft += String.fromCharCode(byte);
    }
    render();
  });

  return await new Promise<never>(() => {});
}

async function runCommandReceiver(commandFile: string, ackPath: string): Promise<never> {
  let offset = 0;
  let timer: ReturnType<typeof setInterval>;
  const consume = () => {
    const next = readNewCmdLines(commandFile, offset);
    offset = next.offset;
    for (const line of next.lines) {
      appendFileSync(ackPath, `${line}\n`);
      try {
        if ((JSON.parse(line) as { type?: string }).type === "close") {
          clearInterval(timer);
          process.exit(0);
        }
      } catch {}
    }
  };
  appendFileSync(ackPath, "__ready__\n");
  timer = setInterval(consume, STRUCTURED_COMMAND_POLL_MS);
  process.once("SIGTERM", () => {
    clearInterval(timer);
    process.exit(0);
  });
  return await new Promise<never>(() => {});
}

const fakeTuiIndex = helperArgument("--fake-tui");
if (fakeTuiIndex >= 0) await runFakeTui(process.argv[fakeTuiIndex + 1]!);
const commandReceiverIndex = helperArgument("--command-receiver");
if (commandReceiverIndex >= 0) {
  await runCommandReceiver(
    process.argv[commandReceiverIndex + 1]!,
    process.argv[commandReceiverIndex + 2]!,
  );
}

function usage(): string {
  return `Usage: bun run bench:agent-transport [options]

Options:
  --iterations <n>  Messages sent through each path (default: ${DEFAULT_ITERATIONS})
  --json            Print machine-readable JSON only
  --help            Show this help`;
}

function parseOptions(args: string[]): Options {
  const options: Options = { iterations: DEFAULT_ITERATIONS, json: false };
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
      const value = Number(args[++index]);
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error("--iterations must be a positive integer");
      }
      options.iterations = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function metric(name: string, workload: string, samples: number[]): Metric {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    name,
    workload,
    samples: samples.length,
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  pollMs = 2,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error("benchmark receiver timed out");
    await sleep(pollMs);
  }
}

function ackCount(path: string): number {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line && line !== "__ready__")
      .length;
  } catch {
    return 0;
  }
}

function receiverReady(path: string): boolean {
  try {
    return readFileSync(path, "utf8").includes("__ready__");
  } catch {
    return false;
  }
}

async function legacyAccept(target: string, text: string): Promise<number> {
  const started = performance.now();
  if (inputBoxText(target)?.includes(text)) throw new Error("legacy fake TUI was not empty");

  tmuxClearInput(target);
  await sleep(LEGACY_CLEAR_DELAY_MS);
  if (!tmuxType(target, text)) throw new Error("tmux failed to type the benchmark message");

  let settled = false;
  for (let index = 0; index < 20; index++) {
    await sleep(LEGACY_CONFIRM_POLL_MS);
    if (inputBoxText(target)?.includes(text)) {
      settled = true;
      break;
    }
  }
  if (!settled) throw new Error("legacy fake TUI did not show the typed message");
  if (!tmuxEnter(target)) throw new Error("tmux failed to submit the benchmark message");

  for (let index = 0; index < 24; index++) {
    await sleep(LEGACY_CONFIRM_POLL_MS);
    if (!inputBoxText(target)?.includes(text)) return performance.now() - started;
  }
  throw new Error("legacy fake TUI did not accept the message");
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

async function waitForProcessExit(process: ReturnType<typeof Bun.spawn>, timeoutMs: number): Promise<void> {
  await Promise.race([process.exited.then(() => undefined), sleep(timeoutMs)]);
  if (process.exitCode == null) {
    process.kill("SIGTERM");
    await process.exited;
  }
}

async function benchmarkLifecycle(
  iterations: number,
  root: string,
  suffix: string,
): Promise<{
  legacyStart: number[];
  structuredStart: number[];
  legacyArchive: number[];
  structuredArchive: number[];
}> {
  const legacyStart: number[] = [];
  const structuredStart: number[] = [];
  const legacyArchive: number[] = [];
  const structuredArchive: number[] = [];

  for (let index = 0; index < iterations; index++) {
    const tmuxName = `lfg-bench-start-${suffix}-${index}`;
    const ackPath = join(root, `legacy-start-${index}.ack`);
    const started = performance.now();
    const tmuxStart = Bun.spawnSync([
      "tmux", "new-session", "-d", "-s", tmuxName,
      process.execPath, SCRIPT_PATH, "--fake-tui", ackPath,
    ], { stdout: "pipe", stderr: "pipe" });
    if (tmuxStart.exitCode !== 0) {
      throw new Error(tmuxStart.stderr.toString() || "failed to start lifecycle tmux session");
    }
    await waitFor(() => inputBoxText(tmuxName) !== null, 5_000, 2);
    legacyStart.push(performance.now() - started);

    const archiveStarted = performance.now();
    const killed = Bun.spawnSync(["tmux", "kill-session", "-t", `=${tmuxName}`], {
      stdout: "ignore",
      stderr: "pipe",
    });
    if (killed.exitCode !== 0) {
      throw new Error(killed.stderr.toString() || "failed to archive lifecycle tmux session");
    }
    await waitFor(() => !tmuxHasSession(tmuxName), 2_000, 2);
    legacyArchive.push(performance.now() - archiveStarted);
  }

  for (let index = 0; index < iterations; index++) {
    const sessionId = `lifecycle-${suffix}-${index}`;
    const commandFile = cmdPath(sessionId);
    const ackPath = join(root, `structured-start-${index}.ack`);
    const started = performance.now();
    const receiver = Bun.spawn([
      process.execPath,
      SCRIPT_PATH,
      "--command-receiver",
      commandFile,
      ackPath,
    ], { stdout: "ignore", stderr: "pipe" });
    await waitFor(() => receiverReady(ackPath), 5_000, 2);
    structuredStart.push(performance.now() - started);

    const archiveStarted = performance.now();
    appendCmd(sessionId, { type: "close" });
    // This is the production grace period in closeLiveSession. The harness can
    // exit sooner, but the close owner deliberately waits before it checks.
    await sleep(300);
    await waitForProcessExit(receiver, 100);
    removeEntry(sessionId);
    structuredArchive.push(performance.now() - archiveStarted);
  }

  return { legacyStart, structuredStart, legacyArchive, structuredArchive };
}

async function run(options: Options) {
  const tmuxVersion = Bun.spawnSync(["tmux", "-V"], { stdout: "pipe", stderr: "pipe" });
  if (tmuxVersion.exitCode !== 0) throw new Error("tmux is required for this benchmark");

  const originalDataPath = PATHS.data;
  const root = mkdtempSync(join(tmpdir(), "lfg-agent-transport-benchmark-"));
  PATHS.data = root;
  resetSendQueueStoreConnectionForTests();

  const suffix = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const tmuxName = `lfg-bench-${suffix}`;
  const legacyAck = join(root, "legacy.ack");
  const structuredAck = join(root, "structured.ack");
  const structuredSession = `structured-${suffix}`;
  const commandFile = cmdPath(structuredSession);
  let receiver: ReturnType<typeof Bun.spawn> | null = null;

  try {
    const tmuxStart = Bun.spawnSync([
      "tmux", "new-session", "-d", "-s", tmuxName,
      process.execPath, SCRIPT_PATH, "--fake-tui", legacyAck,
    ], { stdout: "pipe", stderr: "pipe" });
    if (tmuxStart.exitCode !== 0) {
      throw new Error(tmuxStart.stderr.toString() || "failed to start legacy fake TUI");
    }
    await waitFor(() => inputBoxText(tmuxName) !== null, 5_000, 20);

    receiver = Bun.spawn([
      process.execPath,
      SCRIPT_PATH,
      "--command-receiver",
      commandFile,
      structuredAck,
    ], { stdout: "ignore", stderr: "pipe" });
    await waitFor(() => receiverReady(structuredAck), 5_000, 10);

    await legacyAccept(tmuxName, "legacy-warmup");
    appendCmd(structuredSession, { type: "send", text: "structured-warmup" });
    await waitFor(() => ackCount(structuredAck) >= 1, 2_000);

    const legacySamples: number[] = [];
    for (let index = 0; index < options.iterations; index++) {
      legacySamples.push(await legacyAccept(tmuxName, `legacy-${index}`));
    }

    const structuredAppendSamples: number[] = [];
    const structuredAcceptSamples: number[] = [];
    for (let index = 0; index < options.iterations; index++) {
      // Spread sends across the 250 ms poll phase. Without this deterministic
      // jitter, a sequential benchmark always sends immediately after a poll
      // and measures only the worst-case wait.
      await sleep((index * 37) % STRUCTURED_COMMAND_POLL_MS);
      const beforeCount = ackCount(structuredAck);
      const started = performance.now();
      appendCmd(structuredSession, { type: "send", text: `structured-${index}` });
      writeStoredQueueMessage(structuredSession, {
        id: `structured-${index}`,
        text: `structured-${index}`,
        status: "queued",
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      structuredAppendSamples.push(performance.now() - started);
      await waitFor(() => ackCount(structuredAck) > beforeCount, 2_000);
      structuredAcceptSamples.push(performance.now() - started);
    }

    const lifecycle = await benchmarkLifecycle(options.iterations, root, suffix);

    const metrics = [
      metric(
        "legacy_tmux_confirmed_accept",
        "base-commit tmux clear, type, and two visual confirmation polls",
        legacySamples,
      ),
      metric(
        "structured_request_persist",
        "append one command and persist one SQLite queue row",
        structuredAppendSamples,
      ),
      metric(
        "structured_harness_accept",
        "append, persist, poll command file, and parse one command",
        structuredAcceptSamples,
      ),
      metric(
        "legacy_tmux_start_ready",
        "create tmux session, pseudo-terminal, process, and first composer",
        lifecycle.legacyStart,
      ),
      metric(
        "structured_process_start_ready",
        "spawn detached process and publish its control-plane readiness",
        lifecycle.structuredStart,
      ),
      metric(
        "legacy_tmux_archive",
        "kill tmux session and confirm removal",
        lifecycle.legacyArchive,
      ),
      metric(
        "structured_process_archive",
        "append close, honor production grace period, and remove control files",
        lifecycle.structuredArchive,
      ),
    ];
    const legacy = metrics[0]!;
    const structured = metrics[2]!;
    const legacyStart = metrics[3]!;
    const structuredStart = metrics[4]!;
    const legacyArchive = metrics[5]!;
    const structuredArchive = metrics[6]!;
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runtime: {
        bun: Bun.version,
        tmux: tmuxVersion.stdout.toString().trim(),
        platform: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0]?.model ?? "unknown",
        cpuCount: cpus().length,
      },
      git: gitState(),
      config: options,
      constants: {
        legacyClearDelayMs: LEGACY_CLEAR_DELAY_MS,
        legacyConfirmPollMs: LEGACY_CONFIRM_POLL_MS,
        structuredCommandPollMs: STRUCTURED_COMMAND_POLL_MS,
      },
      comparison: {
        p50Speedup: round(legacy.p50Ms / structured.p50Ms),
        p95Speedup: round(legacy.p95Ms / structured.p95Ms),
        p50SavedMs: round(legacy.p50Ms - structured.p50Ms),
        p95SavedMs: round(legacy.p95Ms - structured.p95Ms),
      },
      lifecycleComparison: {
        p50StartSpeedup: round(legacyStart.p50Ms / structuredStart.p50Ms),
        p95StartSpeedup: round(legacyStart.p95Ms / structuredStart.p95Ms),
        p50ArchiveSlowdown: round(structuredArchive.p50Ms / legacyArchive.p50Ms),
        p95ArchiveSlowdown: round(structuredArchive.p95Ms / legacyArchive.p95Ms),
        p50ArchiveAddedMs: round(structuredArchive.p50Ms - legacyArchive.p50Ms),
        p95ArchiveAddedMs: round(structuredArchive.p95Ms - legacyArchive.p95Ms),
      },
      metrics,
    };
  } finally {
    receiver?.kill("SIGTERM");
    Bun.spawnSync(["tmux", "kill-session", "-t", tmuxName], {
      stdout: "ignore",
      stderr: "ignore",
    });
    resetSendQueueStoreConnectionForTests();
    PATHS.data = originalDataPath;
    rmSync(root, { recursive: true, force: true });
  }
}

function printTable(metrics: Metric[]): void {
  const header = ["scenario", "p50 ms", "p95 ms", "p99 ms"];
  const rows = metrics.map((entry) => [
    entry.name,
    entry.p50Ms.toFixed(3),
    entry.p95Ms.toFixed(3),
    entry.p99Ms.toFixed(3),
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

try {
  const options = parseOptions(process.argv.slice(2));
  const result = await run(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("Agent transport A/B benchmark");
    console.log(`Bun ${result.runtime.bun}; ${result.runtime.tmux}; ${result.runtime.platform} ${result.runtime.arch}`);
    console.log(`Git ${result.git.revision}${result.git.dirty ? " (dirty)" : ""}`);
    console.log(`Messages per path: ${options.iterations}`);
    console.log("");
    printTable(result.metrics);
    console.log("");
    console.log(
      `Structured harness acceptance is ${result.comparison.p50Speedup.toFixed(2)}x faster at p50 ` +
      `and ${result.comparison.p95Speedup.toFixed(2)}x faster at p95.`,
    );
    console.log(
      `Structured process startup is ${result.lifecycleComparison.p50StartSpeedup.toFixed(2)}x faster at p50.`,
    );
    console.log(
      `Structured archive adds ${result.lifecycleComparison.p50ArchiveAddedMs.toFixed(2)} ms at p50.`,
    );
    console.log("This benchmark excludes provider, network, and model generation time.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(1);
}
