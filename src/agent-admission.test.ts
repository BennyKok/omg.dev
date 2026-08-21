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
  interactiveResidentCount,
  isScheduleSpawned,
  scheduleResidentCount,
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

  test("scheduled runs sit in their own resident pool", () => {
    const sessions = [
      { busy: false, spawnedBy: "schedule" },
      { busy: false },
      { launching: true, spawnedBy: "schedule" },
    ];
    expect(interactiveResidentCount(sessions)).toBe(1);
    expect(scheduleResidentCount(sessions)).toBe(2);
    expect(isScheduleSpawned("schedule")).toBe(true);
    expect(isScheduleSpawned("subagent")).toBe(false);
  });

  test("persistent bots stay visible but do not fill the interactive cap", () => {
    const sessions = [{ persistent: true, spawnedBy: "bot" }, { busy: false }];
    expect(residentAgentCount(sessions)).toBe(2);
    expect(interactiveResidentCount(sessions)).toBe(1);
  });

  test("an idle-only fleet can still fill the cap", () => {
    const controller = new AgentAdmissionController();
    const idle = [{ busy: false }, { busy: false }];
    expect(controller.tryAcquire(2, idle).ok).toBe(false);
    // ...and one free slot admits exactly one.
    expect(controller.tryAcquire(3, idle).ok).toBe(true);
  });

  test("takes the limit from the control plane, whatever the plan is called", () => {
    expect(
      computerAgentAdmissionContext('{"plan":"computer_10","limit":16,"scheduleLimit":3}'),
    ).toEqual({ plan: "computer_10", limit: 16, scheduleLimit: 3 });
    // The regression this replaced: computer_s20 shipped after the last LFG
    // release, so the baked plan table did not know the name and demoted a
    // paid Computer to a single agent. A name is no longer a decision.
    expect(
      computerAgentAdmissionContext('{"plan":"computer_s20","limit":3,"scheduleLimit":1}'),
    ).toEqual({ plan: "computer_s20", limit: 3, scheduleLimit: 1 });
    // A plan invented after this bundle was built needs no LFG release at all.
    expect(
      computerAgentAdmissionContext('{"plan":"computer_unheard_of","limit":7,"scheduleLimit":2}'),
    ).toEqual({ plan: "computer_unheard_of", limit: 7, scheduleLimit: 2 });
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

  test("an unreadable entitlement holds at one agent rather than guessing", () => {
    for (const bad of [
      "retired-plan",
      '{"limit":0,"scheduleLimit":1}',
      '{"limit":3}',
      '{"limit":2.5,"scheduleLimit":1}',
      '"computer_5"',
    ]) {
      expect(computerAgentAdmissionContext(bad), bad).toEqual({
        plan: "unknown",
        limit: 1,
        scheduleLimit: 1,
      });
    }
    // No entitlement at all is an ordinary self-hosted box, not a broken
    // Computer, and it keeps its own local setting policy.
    expect(computerAgentAdmissionContext("")).toBeNull();
  });

  test("clamps an absurd supplied limit instead of disabling admission", () => {
    expect(
      computerAgentAdmissionContext('{"plan":"x","limit":99999,"scheduleLimit":99999}'),
    ).toEqual({ plan: "x", limit: 64, scheduleLimit: 64 });
  });

  test("accepts an additive persistent-bot entitlement without deriving it from plan", () => {
    expect(computerAgentAdmissionContext(
      '{"plan":"custom","limit":4,"scheduleLimit":2,"persistentBotLimit":37}',
    )).toEqual({ plan: "custom", limit: 4, scheduleLimit: 2, persistentBotLimit: 37 });
    expect(computerAgentAdmissionContext(
      '{"plan":"custom","limit":4,"scheduleLimit":2}',
    )).toEqual({ plan: "custom", limit: 4, scheduleLimit: 2 });
    expect(computerAgentAdmissionContext(
      '{"plan":"custom","limit":4,"scheduleLimit":2,"persistentBotLimit":"team"}',
    )).toEqual({ plan: "custom", limit: 4, scheduleLimit: 2 });
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

  test("the entitlement file can change a live process admission limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "lfg-computer-entitlement-"));
    const path = join(dir, "computer-entitlement.json");
    try {
      writeFileSync(path, '{"plan":"computer_5","limit":5,"scheduleLimit":2}\n');
      expect(computerAgentAdmissionContext(undefined, path)).toEqual({
        plan: "computer_5",
        limit: 5,
        scheduleLimit: 2,
      });
      // A downgrade lands on the next admission, with no restart.
      writeFileSync(path, '{"plan":"free","limit":3,"scheduleLimit":1}\n');
      expect(computerAgentAdmissionContext(undefined, path)).toEqual({
        plan: "free",
        limit: 3,
        scheduleLimit: 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
