import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  autoAgentEnabledForBackend,
  normalizeStoredAutoAgents,
  type AutoAgent,
} from "./store.ts";

function row(agent: AutoAgent["agent"], enabled = true): AutoAgent {
  return {
    id: agent ?? "default",
    name: "test",
    prompt: "test",
    schedule: "0 9 * * *",
    enabled,
    agent,
  };
}

test("stored Hermes schedules are retained but disabled", () => {
  const hermes = row("hermes");
  const claude = row("aisdk");
  const normalized = normalizeStoredAutoAgents([hermes, claude]);

  expect(normalized[0]).toEqual({ ...hermes, enabled: false });
  expect(normalized[1]).toBe(claude);
});

test("an already disabled Hermes record is not rewritten", () => {
  const hermes = row("hermes", false);
  expect(normalizeStoredAutoAgents([hermes])[0]).toBe(hermes);
});

test("a later edit cannot re-enable a Hermes schedule", () => {
  expect(autoAgentEnabledForBackend(true, "hermes")).toBe(false);
  expect(autoAgentEnabledForBackend(true, "aisdk")).toBe(true);
});

test("Hermes has no executable, setup, discovery, or environment path", () => {
  const root = join(import.meta.dir, "../..");
  expect(existsSync(join(root, "src/agents/backends/hermes-cli.ts"))).toBe(false);

  for (const file of ["src/coding-agents.ts", "src/model-discovery.ts", ".env.example"]) {
    const source = readFileSync(join(root, file), "utf8");
    expect(source, file).not.toContain("hermesPath");
    expect(source, file).not.toContain("LFG_HERMES");
    expect(source, file).not.toContain("OMG_HERMES");
  }
});
