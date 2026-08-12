import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  residentAgentCount,
  AgentAdmissionController,
  NO_AGENT_LIMIT,
  agentLaunchMemoryBudget,
  computerAgentAdmissionContext,
} from "./agent-admission.ts";

describe("Computer agent admission", () => {
  test("counts idle agents against the cap, not just working ones", () => {
    // An idle agent still holds its harness, backend and MCP servers. Counting
    // only `busy` here is what let a 22 GB box admit a dozen silent sessions
    // and then OOM, so all three of these occupy a slot.
    expect(
      residentAgentCount([{ busy: true }, { launching: true }, { busy: false }]),
    ).toBe(3);
  });

  test("an idle-only fleet can still fill the cap", () => {
    const controller = new AgentAdmissionController();
    const idle = [{ busy: false }, { busy: false }];
    expect(controller.tryAcquire(2, idle).ok).toBe(false);
    // ...and one free slot admits exactly one.
    expect(controller.tryAcquire(3, idle).ok).toBe(true);
  });

  test("denies at the plan limit and exposes plan context", () => {
    expect(computerAgentAdmissionContext("free")).toEqual({
      plan: "free",
      limit: 1,
    });
    expect(computerAgentAdmissionContext("computer_5")).toEqual({
      plan: "computer_5",
      limit: 5,
    });
    expect(computerAgentAdmissionContext("computer_10")).toEqual({
      plan: "computer_10",
      limit: 16,
    });
    expect(computerAgentAdmissionContext("computer_20")).toEqual({
      plan: "computer_20",
      limit: 24,
    });
    expect(computerAgentAdmissionContext("computer_early")).toEqual({
      plan: "computer_early",
      limit: 24,
    });
    expect(computerAgentAdmissionContext("computer_trial")).toEqual({
      plan: "computer_trial",
      limit: 1,
    });
    const admission = new AgentAdmissionController();
    expect(admission.tryAcquire(1, [{ busy: true }])).toMatchObject({
      ok: false,
      resident: 1,
      reserved: 0,
    });
  });

  test("a slot is freed by the agent exiting, not by it going idle", () => {
    const admission = new AgentAdmissionController();
    const initial = admission.tryAcquire(1, []);
    expect(initial.ok).toBe(true);
    expect(admission.tryAcquire(1, [])).toMatchObject({
      ok: false,
      resident: 0,
      reserved: 1,
    });
    if (initial.ok) initial.release();
    expect(admission.tryAcquire(1, [{ busy: true }])).toMatchObject({
      ok: false,
      resident: 1,
    });
    // Finishing a turn does NOT hand the slot back: the agent is still resident
    // and still holding its memory. Only leaving the session list does.
    expect(admission.tryAcquire(1, [{ busy: false }])).toMatchObject({
      ok: false,
      resident: 1,
    });
    expect(admission.tryAcquire(1, []).ok).toBe(true);
  });

  test("simultaneous launch attempts cannot oversubscribe a slot", () => {
    const admission = new AgentAdmissionController();
    const results = Array.from({ length: 20 }, () =>
      admission.tryAcquire(1, []),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(admission.reserved).toBe(1);
  });

  test("a Computer launch preserves host memory headroom", () => {
    const gib = 1024 ** 3;
    const budget = agentLaunchMemoryBudget(4 * gib, 1.5 * gib);
    expect(budget).toEqual({
      availableBytes: 1.5 * gib,
      reserveBytes: 768 * 1024 ** 2,
      launchBytes: gib,
    });
    const admission = new AgentAdmissionController();
    expect(admission.tryAcquire(10, [], budget)).toMatchObject({
      ok: false,
      reason: "memory",
      availableBytes: 1.5 * gib,
      requiredBytes: 1.75 * gib,
    });
  });

  test("pending launches reserve memory atomically and release it", () => {
    const gib = 1024 ** 3;
    const budget = agentLaunchMemoryBudget(4 * gib, 2.75 * gib);
    const admission = new AgentAdmissionController();
    const first = admission.tryAcquire(10, [], budget);
    const second = admission.tryAcquire(10, [], budget);
    const third = admission.tryAcquire(10, [], budget);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third).toMatchObject({ ok: false, reason: "memory" });
    expect(admission.reservedBytes).toBe(2 * gib);
    if (first.ok) first.release();
    expect(admission.tryAcquire(10, [], budget).ok).toBe(true);
  });

  test("memory reclaim and reservation have one asynchronous owner", async () => {
    const gib = 1024 ** 3;
    const admission = new AgentAdmissionController();
    let available = 1.5 * gib;
    let reclaimed = 0;
    const inspect = async () => ({
      sessions: [],
      memory: agentLaunchMemoryBudget(4 * gib, available),
    });
    const reclaim = async () => {
      reclaimed++;
      available = 2.75 * gib;
      return 2;
    };

    const [first, second] = await Promise.all([
      admission.acquire(1, inspect, reclaim),
      admission.acquire(1, inspect, reclaim),
    ]);

    expect(first).toMatchObject({ ok: true, reclaimed: 2 });
    expect(second).toMatchObject({ ok: false, reason: "limit", reserved: 1 });
    expect(reclaimed).toBe(1);
    if (first.ok) first.release();
  });

  test("a launch storm stops exactly at every paid plan ceiling", () => {
    for (const [plan, limit] of [
      ["computer_5", 5],
      ["computer_10", 16],
      ["computer_20", 24],
    ] as const) {
      const admission = new AgentAdmissionController();
      const attempts = Array.from({ length: 40 }, () =>
        admission.tryAcquire(limit, []),
      );
      expect(
        attempts.filter((result) => result.ok),
        plan,
      ).toHaveLength(limit);
      expect(admission.reserved, plan).toBe(limit);
      expect(
        attempts.slice(limit).every((result) => !result.ok),
        plan,
      ).toBe(true);
    }
  });

  test("fails safe to free when a cloud plan is unknown", () => {
    expect(computerAgentAdmissionContext("retired-plan")).toEqual({
      plan: "free",
      limit: 1,
    });
    expect(computerAgentAdmissionContext("")).toBeNull();
  });

  test("NO_AGENT_LIMIT waives the count, and ONLY the count", () => {
    // The self-hosted override. Discarding the cap must not also discard the
    // memory budget — that budget is the whole reason overriding is safe to
    // offer, and a box that says yes to every launch is the OOM this gate was
    // built to prevent.
    const controller = new AgentAdmissionController();
    const crowded = [{ busy: true }, { busy: true }, { busy: false }];
    expect(controller.tryAcquire(2, crowded).ok).toBe(false);
    expect(controller.tryAcquire(NO_AGENT_LIMIT, crowded).ok).toBe(true);

    const starved = new AgentAdmissionController();
    const noRoom = agentLaunchMemoryBudget(8 * 1024 ** 3, 256 * 1024 ** 2);
    const denied = starved.tryAcquire(NO_AGENT_LIMIT, crowded, noRoom);
    expect(denied).toMatchObject({ ok: false, reason: "memory" });
  });

  test("an unenforced admission still books its memory against the next one", () => {
    // The count-capped path admits without gating on memory. It must still
    // RESERVE, or a launch that does gate — a Computer, or a self-hosted
    // override — reads memory three in-flight starts have already promised
    // away, and admits on the strength of it.
    const controller = new AgentAdmissionController();
    const budget = agentLaunchMemoryBudget(8 * 1024 ** 3, 3 * 1024 ** 3);
    // Two unenforced launches, each booking its 1 GiB.
    expect(controller.tryAcquire(8, [], budget, { enforceMemory: false }).ok).toBe(true);
    expect(controller.tryAcquire(8, [], budget, { enforceMemory: false }).ok).toBe(true);
    // 3 GiB available - 2 GiB reserved = 1 GiB, short of 768 MiB + 1 GiB.
    expect(controller.tryAcquire(NO_AGENT_LIMIT, [], budget)).toMatchObject({
      ok: false,
      reason: "memory",
    });
  });

  test("the managed plan file can change a live process admission limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "lfg-computer-plan-"));
    const path = join(dir, "computer-plan");
    try {
      writeFileSync(path, "computer_5\n");
      expect(computerAgentAdmissionContext(undefined, path)).toEqual({
        plan: "computer_5",
        limit: 5,
      });
      writeFileSync(path, "free\n");
      expect(computerAgentAdmissionContext(undefined, path)).toEqual({
        plan: "free",
        limit: 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
