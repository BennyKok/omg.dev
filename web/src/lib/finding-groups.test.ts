import { describe, expect, test } from "bun:test";
import { findingSeenAt, groupFindingsByAgent, sortFindings } from "./finding-groups";

type F = Parameters<typeof groupFindingsByAgent>[0][number];

const f = (
  id: string,
  agentId: string,
  severity: F["severity"],
  createdAt: number,
  lastSeenAt?: number,
): F => ({ id, agentId, severity, createdAt, lastSeenAt });

describe("groupFindingsByAgent", () => {
  test("one report per agent, count preserved", () => {
    const reports = groupFindingsByAgent([
      f("a1", "fleet", "low", 10),
      f("a2", "fleet", "low", 20),
      f("b1", "ci", "med", 15),
    ]);
    expect(reports.map((r) => [r.agentId, r.findings.length])).toEqual([
      ["fleet", 2],
      ["ci", 1],
    ]);
  });

  test("report severity is the worst finding, not the newest", () => {
    const [report] = groupFindingsByAgent([
      f("a1", "fleet", "low", 100),
      f("a2", "fleet", "high", 1),
    ]);
    expect(report.severity).toBe("high");
    expect(report.findings.map((x) => x.id)).toEqual(["a2", "a1"]);
  });

  test("a recurrence counts as a sighting for ordering", () => {
    const old = f("a1", "fleet", "med", 1, 500);
    const fresh = f("b1", "ci", "med", 300);
    expect(findingSeenAt(old)).toBe(500);
    const reports = groupFindingsByAgent([fresh, old]);
    expect(reports.map((r) => r.agentId)).toEqual(["fleet", "ci"]);
    expect(reports[0].latestAt).toBe(500);
  });

  test("the most recent agent sorts first, whatever its severity", () => {
    const reports = groupFindingsByAgent([
      f("b1", "loud", "high", 1),
      f("a1", "quiet", "low", 1000),
      f("c1", "mid", "med", 500),
    ]);
    expect(reports.map((r) => r.agentId)).toEqual(["quiet", "mid", "loud"]);
    expect(reports[2].severity).toBe("high");
  });

  test("a new finding moves its agent's group to the top", () => {
    const before = groupFindingsByAgent([
      f("a1", "fleet", "low", 100),
      f("b1", "ci", "low", 200),
    ]);
    expect(before.map((r) => r.agentId)).toEqual(["ci", "fleet"]);
    const after = groupFindingsByAgent([
      f("a1", "fleet", "low", 100),
      f("b1", "ci", "low", 200),
      f("a2", "fleet", "low", 300),
    ]);
    expect(after.map((r) => r.agentId)).toEqual(["fleet", "ci"]);
  });

  test("sortFindings does not mutate its input", () => {
    const input = [f("a1", "x", "low", 1), f("a2", "x", "high", 2)];
    const sorted = sortFindings(input);
    expect(sorted.map((x) => x.id)).toEqual(["a2", "a1"]);
    expect(input.map((x) => x.id)).toEqual(["a1", "a2"]);
  });

  test("empty input gives no reports", () => {
    expect(groupFindingsByAgent([])).toEqual([]);
  });
});
