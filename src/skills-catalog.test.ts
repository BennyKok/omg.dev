import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillCatalog, skillCatalogRoots } from "./skills-catalog.ts";

const home = mkdtempSync(join(tmpdir(), "omg-skill-catalog-"));
const repo = join(home, "project");
function skill(path: string, name: string) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: fixture\n---\nSearchable fixture body.`);
}
beforeAll(() => {
  for (const provider of ["claude", "codex", "grok", "agents", "cursor", "opencode", "pi"]) {
    skill(join(repo, `.${provider}`, "skills", `${provider}-fixture`), `${provider}-fixture`);
  }
  skill(join(repo, "skills", "unloaded"), "unloaded");
  for (const provider of ["claude", "codex"]) {
    skill(join(home, `.${provider}`, "plugins", "cache", "market", "plugin", "1", "skills", "fixture"), `${provider}-plugin`);
  }
});
afterAll(() => rmSync(home, { recursive: true, force: true }));
async function catalog(agent: string) {
  const { roots, pluginRoots } = skillCatalogRoots([repo], agent, home);
  return buildSkillCatalog({
    roots: roots.filter((r) => r.root.startsWith(home)),
    pluginRoots: pluginRoots.filter((r) => r.root.startsWith(home)),
  });
}
describe("agent skill discovery", () => {
  test("Claude excludes foreign and arbitrary shared roots", async () => {
    const names = (await catalog("claude")).map((s) => s.name);
    expect(names).toContain("claude-fixture");
    expect(names).not.toContain("codex-fixture");
    expect(names).not.toContain("agents-fixture");
    expect(names).not.toContain("unloaded");
  });
  test("Grok offers its native and shared skills, never foreign plugin caches", async () => {
    const items = await catalog("grok");
    expect(items.map((s) => s.name)).toEqual(["agents-fixture", "claude-fixture", "cursor-fixture", "grok-fixture"]);
    expect(items.find((s) => s.name === "grok-fixture")?.source).toBe("grok");
  });
  test("Grok respects local compatibility opt-outs", () => {
    const localHome = join(home, "compat-disabled");
    mkdirSync(join(localHome, ".grok"), { recursive: true });
    writeFileSync(join(localHome, ".grok", "config.toml"), "[compat.claude]\nskills = false\n[compat.cursor]\nskills = false\n");
    const roots = skillCatalogRoots([repo], "grok", localHome).roots.map((r) => r.root);
    expect(roots).not.toContain(join(repo, ".claude", "skills"));
    expect(roots).not.toContain(join(repo, ".cursor", "skills"));
    expect(roots).toContain(join(repo, ".grok", "skills"));
  });
  test("SDK adapters use the same roots as their CLI product", () => {
    expect(skillCatalogRoots([repo], "aisdk", home)).toEqual(skillCatalogRoots([repo], "claude", home));
    expect(skillCatalogRoots([repo], "codex-aisdk", home)).toEqual(skillCatalogRoots([repo], "codex", home));
  });
  test("Cursor compatibility does not import foreign plugins", async () => {
    expect((await catalog("cursor")).map((s) => s.name)).toEqual([
      "agents-fixture", "claude-fixture", "codex-fixture", "cursor-fixture",
    ]);
  });
  test("agents without a verified discovery contract do not inherit other catalogs", async () => {
    expect(await catalog("deepseek")).toEqual([]);
  });
});
