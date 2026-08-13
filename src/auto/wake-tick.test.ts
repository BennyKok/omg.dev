import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";

const originalData = PATHS.data;
let testData = "";
let scheduler: typeof import("./scheduler.ts");
let wakeTick: typeof import("./wake-tick.ts");

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-wake-tick-"));
  PATHS.data = testData;
  scheduler = await import("./scheduler.ts");
  wakeTick = await import("./wake-tick.ts");
});

afterAll(async () => {
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

test("the exported scheduler tick is callable and rejects re-entrancy", async () => {
  const first = scheduler.autoSchedulerTickNow();
  expect(await scheduler.autoSchedulerTickNow()).toBe(false);
  expect(await first).toBe(true);
});

test("the wake tick handler responds immediately and starts a tick", async () => {
  let release!: () => void;
  let called = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const response = wakeTick.handleWakeTick(async () => {
    called++;
    await pending;
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  await Promise.resolve();
  expect(called).toBe(1);
  release();
});
