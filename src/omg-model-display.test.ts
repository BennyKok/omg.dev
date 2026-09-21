import { describe, expect, test } from "bun:test";
import {
  humanizeOmgModelName,
  omgModelLabel,
  omgModelSearchText,
  parseOmgModel,
} from "../packages/protocol/src/omg-model-display.ts";
import { OMG_MODELS } from "./omg-models.ts";

describe("omg model display", () => {
  test("every hosted id gets a provider and a short name", () => {
    const labels = OMG_MODELS.map((id) => [id, parseOmgModel(id)!.provider, omgModelLabel(id)]);
    expect(labels).toEqual([
      ["omg/deepseek/deepseek-v4-flash-0731", "deepseek", "DeepSeek V4 Flash"],
      ["omg/deepseek/deepseek-v4-pro", "deepseek", "DeepSeek V4 Pro"],
      ["omg/z-ai/glm-5.3-flash", "z-ai", "GLM 5.3 Flash"],
      ["omg/z-ai/glm-5.2", "z-ai", "GLM 5.2"],
      ["omg/qwen/qwen3.7-plus", "qwen", "Qwen3.7 Plus"],
      ["omg/qwen/qwen3-coder-next", "qwen", "Qwen3 Coder Next"],
      ["omg/minimax/minimax-m3", "minimax", "MiniMax M3"],
      ["omg/x-ai/grok-4.7", "x-ai", "Grok 4.7"],
      ["omg/anthropic/claude-fable-5.1", "anthropic", "Claude Fable 5.1"],
      ["omg/anthropic/claude-opus-4.8", "anthropic", "Claude Opus 4.8"],
      ["omg/anthropic/claude-sonnet-4.6", "anthropic", "Claude Sonnet 4.6"],
      ["omg/openai/gpt-5.6-sol", "openai", "GPT-5.6 Sol"],
      ["omg/openai/gpt-5.6-terra", "openai", "GPT-5.6 Terra"],
      ["omg/openai/gpt-5.6-luna", "openai", "GPT-5.6 Luna"],
    ]);
  });

  test("short names stay unique across the catalog", () => {
    const labels = OMG_MODELS.map(omgModelLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("provider labels use brand casing", () => {
    expect(parseOmgModel("omg/z-ai/glm-5.2")!.providerLabel).toBe("Z.ai");
    expect(parseOmgModel("omg/minimax/minimax-m3")!.providerLabel).toBe("MiniMax");
    expect(parseOmgModel("omg/openai/gpt-5.6-sol")!.providerLabel).toBe("OpenAI");
    expect(parseOmgModel("omg/x-ai/grok-4.7")!.providerLabel).toBe("xAI");
    expect(parseOmgModel("omg/newvendor/thing-1")!.providerLabel).toBe("Newvendor");
  });

  test("ids from other agents pass through unchanged", () => {
    expect(parseOmgModel("claude-opus-4-8")).toBeNull();
    expect(parseOmgModel("gpt-5.6")).toBeNull();
    expect(parseOmgModel("omg/onlyprovider")).toBeNull();
    expect(omgModelLabel("gpt-5.6")).toBe("gpt-5.6");
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
    expect(omgModelSearchText("gpt-5.6")).toBe("gpt-5.6");
  });
});
