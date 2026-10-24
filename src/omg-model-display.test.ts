import { describe, expect, test } from "bun:test";
import {
  humanizeOmgModelName,
  omgModelLabel,
  omgModelSearchText,
  parseOmgModel,
  parseRoutedModel,
  setServerModelLabels as setLabels,
} from "../packages/protocol/src/omg-model-display.ts";
import { OMG_MODELS } from "./omg-models.ts";

describe("omg model display", () => {
  test("every hosted id gets a provider and a short name", () => {
    const labels = OMG_MODELS.map((id) => [id, parseOmgModel(id)!.provider, omgModelLabel(id)]);
    expect(labels).toEqual([
      ["omg/omg/auto", "omg", "Auto"],
      ["omg/omg/max", "omg", "Max"],
      ["omg/omg/balanced", "omg", "Balanced"],
      ["omg/omg/fast", "omg", "Fast"],
      ["omg/omg/build", "omg", "Build"],
      ["omg/anthropic/claude-opus-5.5", "anthropic", "Claude Opus 5.5"],
      ["omg/apex", "callstack", "Apex"],
      ["omg/deepseek/deepseek-v4-flash-0731", "deepseek", "DeepSeek V4 Flash"],
      ["omg/deepseek/deepseek-v4-pro", "deepseek", "DeepSeek V4 Pro"],
      ["omg/z-ai/glm-5.3-flash", "z-ai", "GLM 5.3 Flash"],
      ["omg/z-ai/glm-5.3", "z-ai", "GLM 5.3"],
      ["omg/minimax/minimax-m3", "minimax", "MiniMax M3"],
      ["omg/x-ai/grok-4.7", "x-ai", "Grok 4.7"],
      ["omg/anthropic/claude-fable-5.1", "anthropic", "Claude Fable 5.1"],
      ["omg/anthropic/claude-sonnet-5.5", "anthropic", "Claude Sonnet 5.5"],
      ["omg/anthropic/claude-haiku-5.5", "anthropic", "Claude Haiku 5.5"],
      ["omg/openai/gpt-6.1-sol", "openai", "GPT-6.1 Sol"],
      ["omg/openai/gpt-6-astra", "openai", "GPT-6 Astra"],
      ["omg/openai/gpt-6-luna", "openai", "GPT-6 Luna"],
    ]);
  });

  test("short names stay unique across the catalog", () => {
    const labels = OMG_MODELS.map(omgModelLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("provider labels use brand casing", () => {
    expect(parseOmgModel("omg/z-ai/glm-5.3")!.providerLabel).toBe("Z.ai");
    expect(parseOmgModel("omg/minimax/minimax-m3")!.providerLabel).toBe("MiniMax");
    expect(parseOmgModel("omg/openai/gpt-6.1-sol")!.providerLabel).toBe("OpenAI");
    expect(parseOmgModel("omg/x-ai/grok-4.7")!.providerLabel).toBe("xAI");
    expect(parseOmgModel("omg/newvendor/thing-1")!.providerLabel).toBe("Newvendor");
  });

  test("ids from other agents pass through unchanged", () => {
    expect(parseOmgModel("claude-opus-4-8")).toBeNull();
    expect(parseOmgModel("gpt-5.6")).toBeNull();
    expect(parseOmgModel("omg/onlyprovider")).toBeNull();
    expect(omgModelLabel("grok-4.7")).toBe("grok-4.7");
    expect(omgModelLabel(null)).toBe("");
  });

  test("a trailing snapshot date is dropped from the name only", () => {
    expect(humanizeOmgModelName("deepseek-v4-flash-0731")).toBe("DeepSeek V4 Flash");
    expect(humanizeOmgModelName("model-20260731")).toBe("Model");
    expect(humanizeOmgModelName("0731")).toBe("0731");
  });

  test("the filter matches the id, the provider, and the short name", () => {
    const text = omgModelSearchText("omg/deepseek/deepseek-v4-flash-0731");
    expect(text).toContain("omg/deepseek/deepseek-v4-flash-0731");
    expect(text).toContain("deepseek v4 flash");
    expect(omgModelSearchText("grok-4.7")).toBe("grok-4.7");
  });
});

describe("claude model display", () => {
  test("Claude CLI ids and aliases get a short family name", () => {
    const ids = ["opus", "claude-opus-5-5", "claude-fable-5-1", "fable", "sonnet", "haiku", "claude-opus-4-8-20260101"];
    expect(ids.map((id) => omgModelLabel(id))).toEqual([
      "Opus",
      "Opus 5.5",
      "Fable 5.1",
      "Fable",
      "Sonnet",
      "Haiku",
      "Opus 4.8",
    ]);
  });

  test("Codex ids get the hosted GPT naming", () => {
    expect(["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex-spark"].map((id) => omgModelLabel(id))).toEqual([
      "GPT-6.1 Sol",
      "GPT-6 Sol",
      "GPT-6 Luna",
      "GPT-6 Astra",
      "GPT-5.6 Sol",
      "GPT-5.5",
      "GPT-5.4 Mini",
      "GPT-5.3 Codex Spark",
    ]);
  });

  test("other agents' ids pass through", () => {
    expect(omgModelLabel("grok-4.7")).toBe("grok-4.7");
    expect(omgModelLabel(null)).toBe("");
  });

  test("routed ids such as OpenCode's read as the short name, with route and lab", () => {
    expect(omgModelLabel("anthropic/claude-opus-5")).toBe("Claude Opus 5");
    expect(parseRoutedModel("opencode-go/glm-5.3")).toMatchObject({
      route: "opencode-go",
      routeLabel: "OpenCode Go",
      provider: "z-ai",
      label: "GLM 5.3",
    });
    expect(parseRoutedModel("novita-ai/zai-org/glm-5")).toMatchObject({ routeLabel: "Novita AI", provider: "z-ai", label: "GLM 5" });
    expect(parseRoutedModel("novita-ai/moonshotai/kimi-k3")).toMatchObject({ provider: "moonshot", label: "Kimi K3" });
    expect(parseRoutedModel("xai/grok-4.5")).toMatchObject({ routeLabel: "xAI", provider: "xai", label: "Grok 4.5" });
    expect(parseRoutedModel("opencode-go/claude-haiku-5-5")).toMatchObject({ provider: "anthropic", label: "Claude Haiku 5.5" });
    expect(parseRoutedModel("opencode/big-pickle")).toMatchObject({ routeLabel: "OpenCode Zen", provider: null, label: "Big Pickle" });
    expect(parseRoutedModel("omg/openai/gpt-6.1-sol")).toMatchObject({ route: "omg", provider: "openai", label: "GPT-6.1 Sol" });
    expect(parseRoutedModel("grok-4.7")).toBeNull();
    expect(omgModelSearchText("opencode-go/glm-5.3")).toContain("opencode go");
  });

  test("filter text matches the display name", () => {
    expect(omgModelSearchText("claude-opus-5-5")).toContain("opus 5.5");
  });
});

test("custom models get a readable name, and a server name wins", () => {
  setLabels({});
  expect(omgModelLabel("custom-pc/gemma-4-e4b")).toBe("Gemma 4 E4B");
  expect(omgModelLabel("custom-box/Qwen/Qwen3-8B")).toBe("Qwen3 8B");
  setLabels({ "custom-pc/gemma-4-e4b": "Gemma 4 E4B (3060 Ti)" });
  expect(omgModelLabel("custom-pc/gemma-4-e4b")).toBe("Gemma 4 E4B (3060 Ti)");
  expect(omgModelSearchText("custom-pc/gemma-4-e4b")).toContain("3060 ti");
  setLabels({});
});
