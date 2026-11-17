import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { SkillCatalog, SkillCatalogItem } from "../lib/skill-catalog";
const { SkillSlashSuggest } = await import("./skill-slash-suggest");

let ui: Mounted;
afterEach(() => ui?.cleanup());
const item = (name: string): SkillCatalogItem => ({ name, trigger: name, description: "fixture", source: "agent", path: `${name}/SKILL.md` });

test("switching agents hides old suggestions before the next load completes", async () => {
  let finishGrok!: (items: SkillCatalogItem[]) => void;
  const catalog: SkillCatalog = {
    list: (agent) => agent === "claude"
      ? Promise.resolve([item("claude-only")])
      : new Promise((resolve) => { finishGrok = resolve; }),
    search: async () => [],
  };
  ui = mount();
  const render = (agent: string) => ui.render(<SkillSlashSuggest active={{ query: "" }} agent={agent} catalog={catalog} onPick={() => {}} />);
  render("claude");
  await ui.flushAsync();
  expect(ui.text()).toContain("claude-only");
  render("grok");
  expect(ui.text()).not.toContain("claude-only");
  finishGrok([item("grok-only")]);
  await ui.flushAsync();
  expect(ui.text()).toContain("grok-only");
});

test("late results from the previous agent cannot replace the active suggestions", async () => {
  let finishClaude!: (items: SkillCatalogItem[]) => void;
  const catalog: SkillCatalog = {
    list: (agent) => agent === "claude"
      ? new Promise((resolve) => { finishClaude = resolve; })
      : Promise.resolve([item("grok-only")]),
    search: async () => [],
  };
  ui = mount();
  ui.render(<SkillSlashSuggest active={{ query: "" }} agent="claude" catalog={catalog} onPick={() => {}} />);
  ui.render(<SkillSlashSuggest active={{ query: "" }} agent="grok" catalog={catalog} onPick={() => {}} />);
  await ui.flushAsync();
  finishClaude([item("claude-only")]);
  await ui.flushAsync();
  expect(ui.text()).toContain("grok-only");
  expect(ui.text()).not.toContain("claude-only");
});
