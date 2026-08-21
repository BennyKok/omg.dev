// `lfg agents auto assign` — the §8 migration verb that moves an EXISTING
// schedule onto an existing bot (docs/bot-owned-automations-plan.md §8).
//
// The load-bearing property under test is NOT the output formatting: it is that
// this command is the one write in agents-auto.ts that goes over HTTP to the
// guarded POST /api/auto/agents route instead of calling saveAutoAgent()
// directly. Every ownership rule (target bot exists and is enabled, the per-bot
// cap, the frequency ceiling) lives in that route. A direct store write here
// would be a second, unguarded path to the same state change, which is exactly
// the CLI/HTTP drift this module's header warns about.
import { describe, expect, test } from "bun:test";
import { ownerLabel } from "./agents-auto.ts";
import type { AutoAgent } from "../auto/store.ts";

const SOURCE = await Bun.file(new URL("./agents-auto.ts", import.meta.url)).text();

function assignBody(): string {
  const at = SOURCE.indexOf("async function autoAssign(");
  expect(at, "autoAssign not found").toBeGreaterThanOrEqual(0);
  const end = SOURCE.indexOf("async function autoToggle(", at);
  expect(end).toBeGreaterThan(at);
  return SOURCE.slice(at, end);
}

function agent(owner: AutoAgent["owner"]): AutoAgent {
  return { id: "row-1", name: "Row", prompt: "p", schedule: "0 9 * * *", enabled: true, owner };
}

describe("autoAssign routes through the guarded HTTP endpoint", () => {
  const body = assignBody();

  test("posts to /api/auto/agents rather than writing the store directly", () => {
    expect(body).toContain("/api/auto/agents");
    expect(body).toContain('method: "POST"');
    // The whole point: no local store write on this path.
    expect(body).not.toContain("saveAutoAgent(");
  });

  test("sends the resolved owner in the request body", () => {
    expect(body).toContain('{ kind: "user" as const }');
    expect(body).toContain('{ kind: "bot" as const, botId: botId! }');
    expect(body).toContain("owner,");
  });

  // POST is a full upsert, so a partial body would blank the row's prompt,
  // schedule, backend and cwd — silently destroying the job being migrated.
  test("echoes every field back so the upsert does not blank the row", () => {
    for (const field of [
      "id: agent.id",
      "name: agent.name",
      "prompt: agent.prompt",
      "schedule: agent.schedule",
      "enabled: agent.enabled",
      "cwd: agent.cwd",
      "agent: agent.agent",
      "model: agent.model",
      "thinkingLevel: agent.thinkingLevel",
      "tools: agent.tools",
    ]) {
      expect(body, `missing ${field} in the assign upsert body`).toContain(field);
    }
  });

  test("--bot and --user are mutually exclusive, and one is required", () => {
    expect(body).toContain('hasFlag(args, "--user", "--human", "--headless")');
    expect(body).toContain('option(args, "--bot", "--bot-id")');
    expect(body).toContain('if (toUser && botId) fail("pass either --bot <botId> or --user, not both")');
    expect(body).toContain("if (!toUser && !botId) fail(usage)");
  });

  // An unreachable serve must be a hard failure, never a fallback to an
  // unguarded local write.
  test("an unreachable serve fails loudly instead of bypassing the guards", () => {
    expect(body).toContain("could not reach `lfg serve`");
    const catchAt = body.indexOf("} catch {");
    const failAt = body.indexOf("return fail(", catchAt);
    expect(catchAt).toBeGreaterThanOrEqual(0);
    expect(failAt).toBeGreaterThan(catchAt);
  });

  test("a non-2xx response surfaces the route's own error text", () => {
    expect(body).toContain("if (!res.ok)");
    expect(body).toContain("body?.error ||");
  });

  test("it is wired into the subcommand switch and documented in the help text", () => {
    expect(SOURCE).toContain('case "assign":');
    expect(SOURCE).toContain("return autoAssign(rest);");
    expect(SOURCE).toContain("lfg agents auto assign <id> --bot <botId>");
  });
});

describe("ownerLabel — makes the migration auditable from `auto list`", () => {
  test("a user-owned row reads as headless", () => {
    expect(ownerLabel(agent({ kind: "user" }))).toBe("headless");
  });

  test("a bot-owned row names the owning bot", () => {
    expect(ownerLabel(agent({ kind: "bot", botId: "bot_designer" }))).toBe("bot:bot_designer");
  });

  test("list and show both render the owner, so a migrated row is never ambiguous", () => {
    expect(SOURCE).toContain("ownerLabel(agent).padEnd(18)");
    expect(SOURCE).toContain("owner:    ${ownerLabel(agent)}");
  });
});
