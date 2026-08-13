import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import type { WakeHooksPayload } from "./wake-hooks-push.ts";

describe("wake hook pushes", () => {
  const originalData = PATHS.data;
  const originalUrl = process.env.OMG_SCHEDULE_URL;
  let testData = "";
  let server: ReturnType<typeof Bun.serve> | undefined;
  let received: WakeHooksPayload[];
  let store: typeof import("./store.ts");
  let push: typeof import("./wake-hooks-push.ts");
  let settings: typeof import("../settings.ts");

  beforeAll(async () => {
    testData = await mkdtemp(join(tmpdir(), "lfg-wake-hooks-"));
    PATHS.data = testData;
    store = await import("./store.ts");
    push = await import("./wake-hooks-push.ts");
    settings = await import("../settings.ts");
  });

  beforeEach(async () => {
    await rm(join(testData, "auto"), { recursive: true, force: true });
    received = [];
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        received.push((await req.json()) as WakeHooksPayload);
        return new Response(null, { status: 204 });
      },
    });
    process.env.OMG_SCHEDULE_URL = `${server.url}capture`;
  });

  afterEach(async () => {
    push.cancelScheduledWakeHooksPush();
    push.setWakeHooksBootId(undefined);
    server?.stop(true);
    if (originalUrl === undefined) delete process.env.OMG_SCHEDULE_URL;
    else process.env.OMG_SCHEDULE_URL = originalUrl;
  });

  afterAll(async () => {
    PATHS.data = originalData;
    await rm(testData, { recursive: true, force: true });
  });

  test("sends only the complete schedule set, timezone, and optional boot id", async () => {
    await store.saveAutoAgent({
      id: "private-agent",
      name: "Private name",
      prompt: "secret prompt",
      schedule: "0 9 * * *",
      enabled: true,
      cwd: "/private/worktree",
    });
    push.cancelScheduledWakeHooksPush();

    push.setWakeHooksBootId("boot-123");
    await push.pushWakeHooksNow();

    const firstId = received[0]?.hooks[0]?.id;
    await push.pushWakeHooksNow();

    expect(received[0]).toEqual({
      hooks: [{
        id: expect.stringMatching(/^[0-9a-f]{16}$/),
        schedule: "0 9 * * *",
        enabled: true,
      }],
      tz: settings.getGlobalSettingsSync().timeZone,
      bootId: "boot-123",
    });
    expect(received[1]?.hooks[0]?.id).toBe(firstId);
    expect(JSON.stringify(received[0])).not.toContain("secret prompt");
    expect(JSON.stringify(received[0])).not.toContain("Private name");
    expect(JSON.stringify(received[0])).not.toContain("private-agent");
    expect(JSON.stringify(received[0])).not.toContain("/private/worktree");
  });

  test("debounces a burst into one push", async () => {
    push.scheduleWakeHooksPush(25);
    push.scheduleWakeHooksPush(25);
    push.scheduleWakeHooksPush(25);
    await Bun.sleep(80);
    expect(received).toHaveLength(1);
  });

  test("does nothing when OMG_SCHEDULE_URL is unset", async () => {
    delete process.env.OMG_SCHEDULE_URL;
    await push.pushWakeHooksNow();
    push.scheduleWakeHooksPush(5);
    await Bun.sleep(20);
    expect(received).toHaveLength(0);
  });

  test("delete schedules a full-set push", async () => {
    await store.saveAutoAgent({
      id: "delete-me",
      name: "Delete me",
      prompt: "private",
      schedule: "15 * * * *",
      enabled: true,
    });
    push.cancelScheduledWakeHooksPush();
    await store.deleteAutoAgent("delete-me");
    await Bun.sleep(2_100);
    expect(received).toEqual([{
      hooks: [],
      tz: settings.getGlobalSettingsSync().timeZone,
    }]);
  });
});
