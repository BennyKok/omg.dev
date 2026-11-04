// `omg` may be this CLI or the omg.dev CLI, depending on which comes first on
// PATH — a real situation, not a hypothetical: on a Mac with both installed,
// `omg setup` reaches the omg.dev CLI, which has no `setup`, and prints its
// help instead of doing anything.
//
// So one spelling has to work with either binary. `omg computer <verb>` is that
// spelling: the omg.dev CLI routes it here, and this CLI accepts it directly
// for machines where the omg.dev CLI was never installed.
import { describe, expect, test } from "bun:test";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;

function run(args: string[]): { code: number; out: string } {
  const result = Bun.spawnSync(["bun", "run", CLI, ...args], {
    env: { ...process.env, LFG_INSTALL_CHANNEL: "container" },
  });
  return {
    code: result.exitCode,
    out: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
}

describe("omg computer <verb>", () => {
  test("routes to the same command as the bare verb", () => {
    // `container` makes update refuse in a stable, side-effect-free way, so the
    // two spellings can be compared without touching the machine.
    const bare = run(["update"]);
    const namespaced = run(["computer", "update"]);
    expect(namespaced.out).toBe(bare.out);
    expect(namespaced.code).toBe(bare.code);
  });

  test("forwards flags through the namespace", () => {
    expect(run(["computer", "update", "--help"]).out).toContain("Usage: omg update");
  });

  test("uninstall is reachable both ways", () => {
    expect(run(["computer", "uninstall", "--help"]).out).toContain("Usage:");
  });

  // The omg.dev CLI calls this `computer status`; this CLI has no such command,
  // so it maps to the read-only update check rather than inventing a second
  // status surface that could disagree with it.
  test("computer status reports without changing anything", () => {
    const out = run(["computer", "status"]).out;
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain("Unknown command");
  });

  // A verb this CLI does not have must not be silently swallowed by the
  // namespace — the error should name what was actually typed.
  test("an unknown verb still errors", () => {
    const out = run(["computer", "definitely-not-a-verb"]).out;
    expect(out).toContain("Unknown command");
  });

  test("bare `computer` does not pretend to be a command", () => {
    expect(run(["computer"]).out).toContain("Unknown command");
  });

  test("the bare verbs the service unit and MCP configs use still work", () => {
    // These are invoked as `src/cli.ts <verb>` by the systemd/launchd unit and
    // by every already-registered MCP config. Breaking them would mean
    // migrating third-party agent configs.
    expect(run(["update", "--help"]).out).toContain("Usage: omg update");
    expect(run(["uninstall", "--help"]).out).toContain("Usage:");
  });
});

describe("retired Computer connection", () => {
  for (const args of [["connect"], ["connect", "status", "--json"], ["computer", "connect"]]) {
    test(`exits once for ${args.join(" ")}`, () => {
      const { code, out } = run(args);
      expect(code).toBe(1);
      expect(out).toContain("has been removed");
    });
  }
});
