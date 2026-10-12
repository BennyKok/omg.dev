import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  customInputModalities,
  customModelIds,
  ensureCustomProviders,
  findCustomModel,
  parseCustomModels,
} from "./custom-models.ts";
import { modelsForAgent, OMG_MODELS } from "./agent-catalog.ts";
import { modelSeesImages } from "./omg-capabilities.ts";

let home: string;
let savedHome: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "omg-custom-models-"));
  savedHome = process.env.HOME;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
});

function put(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
const PC = {
  id: "pc",
  name: "3060 Ti",
  baseURL: "http://100.79.118.10:8000/v1/",
  models: [{ id: "gemma-4-e4b", context: 24576, input: ["text", "image"] }],
};
const writeModels = (providers: unknown[]) => put(join(home, ".omg/models.json"), JSON.stringify({ providers }));
const configPath = () => join(home, ".config/opencode/opencode.json");
const options = () => ({ home, env: {} });

test("parse keeps valid providers and drops bad entries", () => {
  const providers = parseCustomModels(JSON.stringify({
    providers: [
      PC,
      { id: "pc", baseURL: "http://dup/v1", models: [{ id: "x" }] },
      { id: "no-url", models: [{ id: "x" }] },
      { id: "bad id!", baseURL: "http://a/v1", models: [{ id: "x" }] },
      { id: "empty", baseURL: "http://a/v1", models: [] },
      { id: "qwen", baseURL: "https://h.example/v1", apiKey: "k", models: [{ id: "Qwen/Qwen3-8B", context: -1 }, { id: "" }] },
    ],
  }));
  expect(providers).toEqual([
    { id: "pc", name: "3060 Ti", baseURL: "http://100.79.118.10:8000/v1", models: [{ id: "gemma-4-e4b", context: 24576, input: ["text", "image"] }] },
    { id: "qwen", baseURL: "https://h.example/v1", apiKey: "k", models: [{ id: "Qwen/Qwen3-8B", input: ["text"] }] },
  ]);
  expect(parseCustomModels("not json")).toEqual([]);
  expect(parseCustomModels("{}")).toEqual([]);
});

test("ids, lookup and modalities come from ~/.omg/models.json", () => {
  expect(customModelIds({ home })).toEqual([]);
  writeModels([PC]);
  expect(customModelIds({ home })).toEqual(["custom-pc/gemma-4-e4b"]);
  expect(findCustomModel("custom-pc/gemma-4-e4b", { home })?.provider.id).toBe("pc");
  expect(findCustomModel("custom-pc/other", { home })).toBeNull();
  expect(findCustomModel("omg/openai/gpt-6-luna", { home })).toBeNull();
  expect(customInputModalities("custom-pc/gemma-4-e4b", { home })).toEqual(["text", "image"]);
});

test("omg picker lists hosted models then custom ones; image support follows the file", () => {
  process.env.HOME = home;
  writeModels([PC, { id: "box", baseURL: "http://box/v1", models: [{ id: "coder" }] }]);
  expect(modelsForAgent("omg")).toEqual([...OMG_MODELS, "custom-pc/gemma-4-e4b", "custom-box/coder"]);
  expect(modelSeesImages("custom-pc/gemma-4-e4b")).toBe(true);
  expect(modelSeesImages("custom-box/coder")).toBe(false);
});

test("ensureCustomProviders writes OpenCode providers next to existing ones", () => {
  put(configPath(), JSON.stringify({ $schema: "x", provider: { omg: { name: "omg" } }, mcp: { a: {} } }));
  writeModels([PC]);
  ensureCustomProviders(options());
  const config = JSON.parse(readFileSync(configPath(), "utf8"));
  expect(config.mcp).toEqual({ a: {} });
  expect(config.provider.omg).toEqual({ name: "omg" });
  expect(config.provider["custom-pc"]).toEqual({
    npm: "@ai-sdk/openai-compatible",
    name: "3060 Ti",
    options: { baseURL: "http://100.79.118.10:8000/v1", apiKey: "none" },
    models: {
      "gemma-4-e4b": {
        name: "gemma-4-e4b",
        limit: { context: 24576, output: 4096 },
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    },
  });
  expect(statSync(configPath()).mode & 0o777).toBe(0o600);
});

test("a provider removed from the file is removed from OpenCode", () => {
  writeModels([PC]);
  ensureCustomProviders(options());
  writeModels([{ id: "box", baseURL: "http://box/v1", models: [{ id: "coder" }] }]);
  ensureCustomProviders(options());
  expect(Object.keys(JSON.parse(readFileSync(configPath(), "utf8")).provider)).toEqual(["custom-box"]);
  rmSync(join(home, ".omg/models.json"));
  ensureCustomProviders(options());
  expect(JSON.parse(readFileSync(configPath(), "utf8")).provider).toEqual({});
});

test("no models and no config writes nothing", () => {
  ensureCustomProviders(options());
  expect(() => statSync(configPath())).toThrow();
});
