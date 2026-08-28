// `codex exec` rollouts carry no `user_message` event. The prompt a
// non-interactive run was given is written only as a `response_item` with
// role "user", and the rollout head scan used to ignore those — so every
// exec session fell back to `basename(cwd)` and a batch of runs in one
// directory produced N identical, unidentifiable rows in the roster and in
// resume history.
//
// These tests pin both halves of the contract: the interactive
// `user_message` event still wins, and the exec fallback picks the real
// prompt rather than the synthetic wrapper blocks codex injects ahead of it.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstUserTextFromTop } from "./sessions.ts";

const roots: string[] = [];

function rollout(lines: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "omg-codex-exec-"));
  roots.push(root);
  const path = join(root, "rollout.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const meta = (source: string) => ({
  timestamp: "2026-01-02T03:04:05.000Z",
  type: "session_meta",
  payload: {
    id: "00000000-0000-4000-8000-000000000000",
    cwd: "/home/dev/repos/vibes",
    originator: source === "exec" ? "codex_exec" : "codex_cli_rs",
    source,
  },
});

const userItem = (text: string) => ({
  timestamp: "2026-01-02T03:04:06.000Z",
  type: "response_item",
  payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
});

const developerItem = (text: string) => ({
  timestamp: "2026-01-02T03:04:06.000Z",
  type: "response_item",
  payload: { type: "message", role: "developer", content: [{ type: "input_text", text }] },
});

const userEvent = (message: string) => ({
  timestamp: "2026-01-02T03:04:07.000Z",
  type: "event_msg",
  payload: { type: "user_message", message },
});

const RECOMMENDED_PLUGINS =
  "<recommended_plugins>\nHere is a list of plugins that are available but not installed.\n</recommended_plugins>";

describe("first user prompt of a codex rollout", () => {
  test("an interactive rollout still reads its user_message event", async () => {
    const path = rollout([
      meta("cli"),
      developerItem("You are Codex, an agent based on GPT-5."),
      userEvent("Rename the deploy script"),
    ]);
    expect(await firstUserTextFromTop(path)).toBe("Rename the deploy script");
  });

  test("a user_message event wins over an earlier response_item user turn", async () => {
    // The two coexist in interactive rollouts: codex records the turn once as
    // an event and again as a request item. The event is the canonical one and
    // must keep winning, or the fallback would quietly change existing titles.
    const path = rollout([
      meta("cli"),
      userItem("Human: raw request-item copy"),
      userEvent("Rename the deploy script"),
    ]);
    expect(await firstUserTextFromTop(path)).toBe("Rename the deploy script");
  });

  test("a codex exec rollout falls back to its request-item prompt", async () => {
    const path = rollout([
      meta("exec"),
      developerItem("You are Codex, an agent based on GPT-5."),
      userItem(RECOMMENDED_PLUGINS),
      userItem("Generate one photorealistic hero image for the kitchen page"),
    ]);
    expect(await firstUserTextFromTop(path)).toBe(
      "Generate one photorealistic hero image for the kitchen page",
    );
  });

  test("synthetic wrapper blocks never become the title", async () => {
    for (const block of [
      RECOMMENDED_PLUGINS,
      "<environment_context>\n  <current_date>2026-01-02</current_date>\n</environment_context>",
      "<user_instructions>\nRepository guidance.\n</user_instructions>",
      "<plugins>\n  <plugin>example</plugin>\n</plugins>",
      "<skill>\n<name>imagegen</name>\n</skill>",
    ]) {
      const path = rollout([meta("exec"), userItem(block)]);
      expect(await firstUserTextFromTop(path)).toBeNull();
    }
  });

  test("the exec prompt is trimmed and keeps its conversation prefix stripped", async () => {
    const path = rollout([meta("exec"), userItem("  Human: Ship the changelog\n\n")]);
    expect(await firstUserTextFromTop(path)).toBe("Ship the changelog");
  });

  test("a rollout with no user turn at all stays null so the caller can fall back", async () => {
    const path = rollout([meta("exec"), developerItem("You are Codex.")]);
    expect(await firstUserTextFromTop(path)).toBeNull();
  });
});
