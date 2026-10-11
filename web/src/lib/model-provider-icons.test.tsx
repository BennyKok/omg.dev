import { mount } from "../test-support/render";
import { expect, test } from "bun:test";
const { ModelProviderIcon, modelProviderIconKey } = await import("./model-provider-icons");

test("all supported providers render a mark, including hyphenated slugs", () => {
  const ui = mount();
  try {
    for (const provider of ["callstack", "anthropic", "deepseek", "minimax", "openai", "qwen", "x-ai", "z-ai"]) {
      ui.render(<ModelProviderIcon provider={provider} className="provider" />);
      expect(ui.query("svg.provider")?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(ui.query("path")?.getAttribute("d")?.length).toBeGreaterThan(20);
    }
    expect(modelProviderIconKey("X-AI")).toBe("xai");
  } finally { ui.cleanup(); }
});

test("unsupported or absent providers do not show a different provider mark", () => {
  const ui = mount();
  try {
    for (const provider of [null, undefined, "", "unknown"]) {
      ui.render(<ModelProviderIcon provider={provider} />);
      expect(ui.query("svg")).toBeNull();
    }
  } finally { ui.cleanup(); }
});
