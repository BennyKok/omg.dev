import { expect, test } from "bun:test";

test("Codex hidden models never reach the picker and discovery order is kept", async () => {
  const { parseCodexModels } = await import("./model-discovery.ts");
  const parsed = parseCodexModels(
    JSON.stringify({
      models: [
        { slug: "gpt-6-astra", visibility: "list" },
        { slug: "gpt-6-sol", visibility: "list" },
        { slug: "gpt-reserve", visibility: "hide" },
        { slug: "gpt-5.5", visibility: "list" },
        { slug: "codex-auto-review", visibility: "hide" },
      ],
    }),
  );
  expect(parsed.models).toEqual(["gpt-6-astra", "gpt-6-sol", "gpt-5.5"]);
});
