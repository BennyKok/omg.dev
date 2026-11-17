import { expect, test } from "bun:test";
import { createSkillCatalog, type SkillCatalogItem } from "./skill-catalog";

const item = (name: string): SkillCatalogItem => ({ name, trigger: name, description: "", source: "agent", path: `${name}/SKILL.md` });

test("concurrent requests and snapshots stay scoped to their agent", async () => {
  const calls: string[] = [];
  const catalog = createSkillCatalog(async (path) => {
    calls.push(path);
    return { skills: [item(new URL(path, "http://localhost").searchParams.get("agent")!)] };
  });
  const [claude, grok, again] = await Promise.all([catalog.list("claude"), catalog.list("grok"), catalog.list("claude")]);
  expect(claude).toEqual([item("claude")]);
  expect(grok).toEqual([item("grok")]);
  expect(again).toEqual(claude);
  await catalog.list("grok");
  expect(calls).toEqual(["/api/skills?agent=claude", "/api/skills?agent=grok"]);
});

test("deep search sends the same agent and encodes the query", async () => {
  const calls: string[] = [];
  const catalog = createSkillCatalog(async (path) => { calls.push(path); return { skills: [] }; });
  await catalog.search("grok", "brand & style");
  expect(calls).toEqual(["/api/skills?agent=grok&q=brand%20%26%20style"]);
});

test("a failed load can be retried without poisoning another agent", async () => {
  let count = 0;
  const catalog = createSkillCatalog(async () => {
    if (++count === 1) throw new Error("offline");
    return { skills: [item("recovered")] };
  });
  await expect(catalog.list("claude")).rejects.toThrow("offline");
  expect(await catalog.list("claude")).toEqual([item("recovered")]);
});
