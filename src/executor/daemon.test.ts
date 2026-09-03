import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS, omgMcpServers } from "../config.ts";
import {
  ensureExecutorAdopted,
  executorAuth,
  executorDashboardUrl,
  executorStatus,
  executorToken,
  resetExecutorStateForTests,
  startExecutor,
  stopExecutor,
} from "./daemon.ts";

let tmp: string;
const originalData = PATHS.data;
const originalPath = process.env.PATH;
const originalBin = process.env.OMG_EXECUTOR_BIN;

// A stand-in `executor` binary: answers /api/health on the requested port
// and records its argv, so the daemon owner can be exercised without the
// real 130 MB binary.
function fakeExecutor(dir: string, body: string): string {
  const path = join(dir, "executor");
  writeFileSync(path, `#!/usr/bin/env bun\n${body}`);
  chmodSync(path, 0o755);
  return path;
}

const HEALTHY = `
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const host = process.argv[process.argv.indexOf("--hostname") + 1];
require("node:fs").writeFileSync(process.env.EXECUTOR_DATA_DIR + "/argv.json", JSON.stringify({ argv: process.argv.slice(2), env: { EXECUTOR_DATA_DIR: process.env.EXECUTOR_DATA_DIR } }));
Bun.serve({ port, hostname: host, fetch(req) {
  const url = new URL(req.url);
  if (url.pathname === "/api/health") return new Response("ok");
  return new Response("nope", { status: 404 });
} });
setInterval(() => {}, 1000);
`;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-executor-"));
  PATHS.data = join(tmp, "data");
  mkdirSync(PATHS.data, { recursive: true });
  resetExecutorStateForTests();
});

afterEach(async () => {
  await stopExecutor();
  resetExecutorStateForTests();
  PATHS.data = originalData;
  process.env.PATH = originalPath;
  if (originalBin === undefined) delete process.env.OMG_EXECUTOR_BIN;
  else process.env.OMG_EXECUTOR_BIN = originalBin;
  rmSync(tmp, { recursive: true, force: true });
});

describe("executor daemon", () => {
  test("reports not installed when no binary is on PATH", async () => {
    process.env.PATH = tmp;
    delete process.env.OMG_EXECUTOR_BIN;
    const status = await startExecutor({ log: () => {} });
    expect(status.installed).toBe(false);
    expect(status.running).toBe(false);
    expect(status.error).toContain("npm install -g executor");
    expect(omgMcpServers("s1").mcpServers?.executor).toBeUndefined();
  });

  test("mints one stable token", () => {
    const first = executorToken();
    expect(first.length).toBeGreaterThan(20);
    expect(executorToken()).toBe(first);
  });

  test("starts the binary on loopback with the omg token and data dir, then advertises the endpoint", async () => {
    process.env.OMG_EXECUTOR_BIN = fakeExecutor(tmp, HEALTHY);
    const status = await startExecutor({ port: 47901, log: () => {} });
    expect(status.running).toBe(true);
    expect(status.origin).toBe("http://127.0.0.1:47901");
    expect(status.error).toBeNull();

    const seen = JSON.parse(readFileSync(join(PATHS.data, "executor", "argv.json"), "utf8")) as {
      argv: string[];
      env: { EXECUTOR_DATA_DIR: string };
    };
    expect(seen.argv.slice(0, 3)).toEqual(["daemon", "run", "--foreground"]);
    expect(seen.argv).toContain("--hostname");
    expect(seen.argv[seen.argv.indexOf("--hostname") + 1]).toBe("127.0.0.1");
    expect(seen.argv[seen.argv.indexOf("--auth-token") + 1]).toBe(executorToken());
    expect(seen.env.EXECUTOR_DATA_DIR).toBe(join(PATHS.data, "executor"));

    expect(executorAuth()).toEqual({ origin: "http://127.0.0.1:47901", token: executorToken() });
    expect(executorDashboardUrl()).toBe(`http://127.0.0.1:47901/?_token=${encodeURIComponent(executorToken())}`);
    expect(omgMcpServers("s1").mcpServers?.executor?.url).toContain("/mcp/executor?session=s1");

    const stopped = await stopExecutor();
    expect(stopped.running).toBe(false);
    expect(executorAuth()).toBeNull();
    expect(omgMcpServers("s1").mcpServers?.executor).toBeUndefined();
  });

  test("a restarted owner adopts the daemon it left running", async () => {
    process.env.OMG_EXECUTOR_BIN = fakeExecutor(tmp, HEALTHY);
    const started = await startExecutor({ port: 47902, log: () => {} });
    expect(started.running).toBe(true);
    const pid = started.pid;

    // Forget the process without killing it, as a serve restart would.
    resetExecutorStateForTests();
    expect(executorStatus().running).toBe(false);

    expect(await ensureExecutorAdopted()).toBe(true);
    const adopted = executorStatus();
    expect(adopted.running).toBe(true);
    expect(adopted.pid).toBe(pid);
    expect(adopted.origin).toBe("http://127.0.0.1:47902");
  });

  test("a stale record is reaped rather than adopted", async () => {
    mkdirSync(join(PATHS.data, "executor"), { recursive: true });
    writeFileSync(
      join(PATHS.data, "executor", "omg-daemon.json"),
      JSON.stringify({ pid: 2_147_483_000, port: 47903, token: "old", startedAt: 1 }),
    );
    expect(await ensureExecutorAdopted()).toBe(false);
    expect(executorStatus().running).toBe(false);
  });

  test("reports a binary that never answers", async () => {
    process.env.OMG_EXECUTOR_BIN = fakeExecutor(tmp, "process.exit(3);");
    const status = await startExecutor({ port: 47904, log: () => {} });
    expect(status.running).toBe(false);
    expect(status.error).toContain("exit");
  });
});
