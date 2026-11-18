import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeAliasVersions, newestClaudeIds, resetClaudeAliasVersionsForTests } from "./claude-alias-versions.ts";
import { claudeAliasLabels } from "./agent-catalog.ts";
import { modelAlias } from "./sessions.ts";

let home: string;
const savedHome = process.env.HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lfg-alias-"));
  process.env.HOME = home;
  resetClaudeAliasVersionsForTests(join(home, "data", "claude-alias-versions.json"));
});
afterEach(() => {
  process.env.HOME = savedHome;
  resetClaudeAliasVersionsForTests();
  rmSync(home, { recursive: true, force: true });
});

const line = (model: string) => JSON.stringify({ type: "assistant", message: { model, content: [] } });

function transcript(dir: string, name: string, models: string[]) {
  const path = join(home, ".claude", "projects", dir);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, `${name}.jsonl`), models.map(line).join("\n") + "\n");
}

test("the newest release per family wins, whatever order it appears in", () => {
  expect(
    newestClaudeIds([
      line("claude-opus-5-5") + line("claude-opus-4-8") + line("claude-opus-5"),
      line("claude-fable-5-1") + line("claude-fable-5-2") + line("claude-haiku-4-5-20251001"),
    ]),
  ).toEqual({ opus: "claude-opus-5-5", fable: "claude-fable-5-2", haiku: "claude-haiku-4-5-20251001" });
});

test("the picker names the release each alias runs on this box", () => {
  transcript("-home-a", "s1", ["claude-opus-5-5", "claude-sonnet-5-5"]);
  transcript("-home-b", "s2", ["claude-fable-5-2", "claude-opus-5"]);
  expect(claudeAliasVersions()).toEqual({ opus: "claude-opus-5-5", fable: "claude-fable-5-2", sonnet: "claude-sonnet-5-5" });
  expect(claudeAliasLabels(["opus", "fable", "sonnet", "haiku"]).modelLabels).toEqual({
    opus: "Opus 5.5",
    fable: "Fable 5.2",
    sonnet: "Sonnet 5.5",
  });
});

test("a box with no transcripts keeps the plain family names", () => {
  expect(claudeAliasVersions()).toEqual({});
  expect(claudeAliasLabels(["opus", "fable"])).toEqual({});
});

test("a session on an older release shows that release, the current one shows the alias", () => {
  transcript("-home-a", "s1", ["claude-opus-5-5"]);
  expect(modelAlias("claude-opus-5-5")).toBe("opus");
  expect(modelAlias("claude-opus-5")).toBe("claude-opus-5");
  // A family with no transcript still collapses, as before.
  expect(modelAlias("claude-sonnet-4-6")).toBe("sonnet");
});

test("with no transcripts, any full id collapses to its family alias", () => {
  expect(modelAlias("claude-opus-5-5")).toBe("opus");
  expect(modelAlias("claude-fable-5-1")).toBe("fable");
  expect(modelAlias("claude-opus-4-8")).toBe("opus");
  expect(modelAlias("claude-sonnet-4-6")).toBe("sonnet");
});

test("a version seen once is kept after its transcript ages out of the scan", () => {
  transcript("-home-a", "old", ["claude-haiku-5-5"]);
  expect(claudeAliasVersions().haiku).toBe("claude-haiku-5-5");
  rmSync(join(home, ".claude", "projects", "-home-a"), { recursive: true });
  transcript("-home-b", "new", ["claude-opus-5-5"]);
  resetClaudeAliasVersionsForTests(join(home, "data", "claude-alias-versions.json"));
  expect(claudeAliasVersions()).toEqual({ opus: "claude-opus-5-5", haiku: "claude-haiku-5-5" });
});
