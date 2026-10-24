import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOmgCatalogCache, refreshOmgModelCatalog } from "./omg-model-catalog.ts";
import {
  applyOmgCatalog,
  isOmgRunnableModel,
  OMG_ALIAS_CATALOG,
  OMG_MODELS,
  omgCatalogFromRouter,
  omgInputModalities,
  omgThinkingLevels,
} from "./omg-models.ts";
import { OMG_ROUTER_FIXTURE } from "./fixtures/omg-agent-catalog.ts";

let dir: string;
let cachePath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omg-catalog-"));
  cachePath = join(dir, "omg-model-catalog.json");
  applyOmgCatalog(OMG_ALIAS_CATALOG, false);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The router's /v1/models?agent=omg rows: catalog fields plus an omgAgent object. */
function routerRows(entries = OMG_ROUTER_FIXTURE) {
  return entries.map((entry) => ({ id: entry.id, name: `${entry.label} (via OpenRouter)`, inputPricePerMillion: 1, omgAgent: entry }));
}

function source(response: () => Response | Promise<Response>, signedIn = true) {
  const paths: string[] = [];
  return {
    paths,
    signedIn: () => signedIn,
    fetch: async (path: string) => {
      paths.push(path);
      return response();
    },
  };
}

// A model the router adds reaches the picker without an lfg release. An older
// generation leaves the picker, but a session that saved it still runs.
test("a router answer replaces the list: new models show, older generations hide but still run", async () => {
  const added = { id: "moonshotai/kimi-k9", label: "Kimi K9", imageInput: true, thinkingLevels: ["low", "high"] };
  const src = source(() => Response.json(routerRows([...OMG_ROUTER_FIXTURE, added])));
  expect(await refreshOmgModelCatalog(src, () => {}, cachePath)).toBe(true);
  expect(src.paths).toEqual(["/api/cli/llm/v1/models?agent=omg"]);
  expect(omgCatalogFromRouter()).toBe(true);
  expect(OMG_MODELS).toContain("omg/moonshotai/kimi-k9");
  expect(omgInputModalities("omg/moonshotai/kimi-k9")).toEqual(["text", "image"]);
  expect(omgThinkingLevels("omg/moonshotai/kimi-k9")).toEqual(["low", "high"]);
  const older = OMG_ROUTER_FIXTURE.filter((entry) => entry.deprecated);
  expect(older.length).toBeGreaterThan(0);
  for (const entry of older) {
    expect(OMG_MODELS).not.toContain(`omg/${entry.id}`);
    expect(isOmgRunnableModel(`omg/${entry.id}`)).toBe(true);
  }
});

// A router outage or a malformed answer must never empty the picker.
test("a failed or unusable answer keeps the current list", async () => {
  applyOmgCatalog(OMG_ROUTER_FIXTURE);
  const before = [...OMG_MODELS];
  const events: Record<string, unknown>[] = [];
  for (const response of [
    () => new Response("down", { status: 502 }),
    () => Response.json({ error: "nope" }),
    () => Response.json([{ id: "x" }]),
    () => { throw new Error("offline"); },
  ]) {
    expect(await refreshOmgModelCatalog(source(response), (fields) => events.push(fields), cachePath)).toBe(false);
  }
  expect(OMG_MODELS).toEqual(before);
  expect(existsSync(cachePath)).toBe(false);
  expect(events.map((event) => event.result)).toEqual(["router_unavailable", "invalid_catalog", "invalid_catalog", "request_failed"]);
});

test("signed out, nothing is fetched and the list stays", async () => {
  const src = source(() => Response.json(routerRows()), false);
  expect(await refreshOmgModelCatalog(src, () => {}, cachePath)).toBe(false);
  expect(src.paths).toEqual([]);
  expect(omgCatalogFromRouter()).toBe(false);
});

// After a restart, or in a separate CLI process, the last router answer is the
// starting list, so a saved concrete model resolves before the next refresh.
test("the last router answer is cached and loaded on the next start", async () => {
  await refreshOmgModelCatalog(source(() => Response.json(routerRows())), () => {}, cachePath);
  applyOmgCatalog(OMG_ALIAS_CATALOG, false);
  expect(isOmgRunnableModel("omg/z-ai/glm-5.3")).toBe(false);
  expect(loadOmgCatalogCache(cachePath)).toBe(true);
  expect(isOmgRunnableModel("omg/z-ai/glm-5.3")).toBe(true);
  expect(omgCatalogFromRouter()).toBe(true);
  expect(loadOmgCatalogCache(join(dir, "missing.json"))).toBe(false);
});

// Session create, resume and auto-agent checks share this rule. It fails if a
// saved older model is rejected, or an id the router dropped is accepted.
test("an older generation is allowed, and an unlisted id is rejected once the router answered", async () => {
  const { isAllowedModelForAgent, modelsForAgent } = await import("./agent-catalog.ts");
  expect(isAllowedModelForAgent("omg", "omg/z-ai/glm-5.3")).toBe(true);
  applyOmgCatalog(OMG_ROUTER_FIXTURE);
  expect(modelsForAgent("omg")).not.toContain("omg/z-ai/glm-5.2");
  expect(isAllowedModelForAgent("omg", "omg/z-ai/glm-5.2")).toBe(true);
  expect(isAllowedModelForAgent("omg", "omg/z-ai/glm-4.0")).toBe(false);
  expect(isAllowedModelForAgent("omg", "not-an-omg-id")).toBe(false);
});
