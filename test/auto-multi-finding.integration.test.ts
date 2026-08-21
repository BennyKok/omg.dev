import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../src/config.ts";
import type { AutoAgent } from "../src/auto/store.ts";

// End-to-end through the REAL findings store: stub only the model call, then
// assert what actually lands on disk. The unit tests cover parsing and ranking;
// this covers the thing that was structurally impossible before — one run
// filing more than one finding.
//
// PATHS.data is repo-relative, so this writes to THIS worktree's data/auto,
// never the live findings feed. Push is a no-op here because a fresh worktree
// has no subscriptions.

let reply = "";

mock.module("../src/agents/backends/claude-ai-sdk.ts", () => ({
  pipeToClaudeAiSdk: async () => reply,
}));

const findingsFile = join(PATHS.data, "auto", "findings.jsonl");

async function readFiled(agentId: string) {
  const f = Bun.file(findingsFile);
  if (!(await f.exists())) return [];
  return (await f.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.agentId === agentId);
}

const agent = (id: string): AutoAgent =>
  ({ id, name: id, prompt: "watch something", schedule: "0 11 * * *", enabled: true, cwd: PATHS.root }) as AutoAgent;

beforeEach(async () => {
  await rm(findingsFile, { force: true });
});

afterEach(async () => {
  await rm(findingsFile, { force: true });
});

describe("a single run filing multiple findings", () => {
  test("three independent findings all persist and are all returned", async () => {
    const { runAutoAgent } = await import("../src/auto/runner.ts");
    reply = JSON.stringify({
      findings: [
        { title: "auth 500s spiking", severity: "high", suggest: "roll back" },
        { title: "snapshot GC stalled", severity: "med", reasoning: ["42GB orphaned"] },
        { title: "stale dep in web", severity: "low" },
      ],
    });

    const out = await runAutoAgent(agent("multi-test"), () => {});

    expect(out).toHaveLength(3);
    const filed = await readFiled("multi-test");
    expect(filed).toHaveLength(3);
    expect(filed.map((f) => f.title).sort()).toEqual(
      ["auth 500s spiking", "snapshot GC stalled", "stale dep in web"].sort(),
    );
    // Severity and payload survive the round trip, per finding.
    const high = filed.find((f) => f.title === "auth 500s spiking");
    expect(high.severity).toBe("high");
    expect(high.suggest).toBe("roll back");
    expect(filed.find((f) => f.title === "snapshot GC stalled").reasoning).toEqual(["42GB orphaned"]);
  });

  test("the legacy single-finding shape still files exactly one", async () => {
    const { runAutoAgent } = await import("../src/auto/runner.ts");
    reply = JSON.stringify({ finding: { title: "legacy shape", severity: "high" } });

    const out = await runAutoAgent(agent("legacy-test"), () => {});

    expect(out).toHaveLength(1);
    expect(await readFiled("legacy-test")).toHaveLength(1);
  });

  test("explicit silence files nothing", async () => {
    const { runAutoAgent } = await import("../src/auto/runner.ts");
    reply = JSON.stringify({ findings: [] });

    expect(await runAutoAgent(agent("silent-test"), () => {})).toHaveLength(0);
    expect(await readFiled("silent-test")).toHaveLength(0);
  });

  test("unparseable output files nothing rather than throwing", async () => {
    const { runAutoAgent } = await import("../src/auto/runner.ts");
    reply = "I was unable to complete the analysis.";

    expect(await runAutoAgent(agent("junk-test"), () => {})).toHaveLength(0);
    expect(await readFiled("junk-test")).toHaveLength(0);
  });

  test("a run over the cap files only the 5 most severe", async () => {
    const { runAutoAgent } = await import("../src/auto/runner.ts");
    reply = JSON.stringify({
      findings: [
        ...Array.from({ length: 6 }, (_, i) => ({ title: `nit ${i}`, severity: "low" })),
        { title: "the actual outage", severity: "high" },
      ],
    });

    const out = await runAutoAgent(agent("cap-test"), () => {});

    expect(out).toHaveLength(5);
    const filed = await readFiled("cap-test");
    expect(filed).toHaveLength(5);
    expect(filed.map((f) => f.title)).toContain("the actual outage");
  });

  test("a verbatim duplicate in one run is filed once, WITHOUT inflating occurrences", async () => {
    // A model listing the same problem twice is an artifact. Counting it as a
    // recurrence would fake the "this is persistent" signal.
    const { runAutoAgent } = await import("../src/auto/runner.ts");
    reply = JSON.stringify({
      findings: [
        { title: "duplicated problem", severity: "high" },
        { title: "duplicated problem", severity: "high" },
      ],
    });

    const out = await runAutoAgent(agent("dupe-test"), () => {});

    const filed = await readFiled("dupe-test");
    expect(filed).toHaveLength(1);
    expect(filed[0].occurrences ?? 1).toBe(1);
    expect(out).toHaveLength(1);
  });

  test("two per-host findings differing only by digits stay TWO findings", async () => {
    // The regression this pins: normTitle strips digits, so "box-1 disk 91%
    // full" and "box-3 disk 93% full" both normalize to "box# disk #% full".
    // Before the intra-run exclusion, box-3 silently vanished into box-1.
    const { runAutoAgent } = await import("../src/auto/runner.ts");
    reply = JSON.stringify({
      findings: [
        { title: "box-1 disk 91% full", severity: "high" },
        { title: "box-3 disk 93% full", severity: "high" },
      ],
    });

    const out = await runAutoAgent(agent("perhost-test"), () => {});

    expect(out).toHaveLength(2);
    const filed = await readFiled("perhost-test");
    expect(filed).toHaveLength(2);
    expect(filed.map((f) => f.title).sort()).toEqual([
      "box-1 disk 91% full",
      "box-3 disk 93% full",
    ]);
  });

  test("across runs, a moved number is still ONE recurring finding", async () => {
    // The complement of the test above: intra-run exclusion must not break the
    // cross-run recurrence that digit-stripping exists to provide.
    const { runAutoAgent } = await import("../src/auto/runner.ts");

    reply = JSON.stringify({ findings: [{ title: "sqld WAL is 2.3 GB", severity: "med" }] });
    await runAutoAgent(agent("recur-test"), () => {});

    reply = JSON.stringify({ findings: [{ title: "sqld WAL is 3.1 GB", severity: "med" }] });
    await runAutoAgent(agent("recur-test"), () => {});

    const filed = await readFiled("recur-test");
    expect(filed).toHaveLength(1);
    expect(filed[0].occurrences).toBe(2);
  });
});
