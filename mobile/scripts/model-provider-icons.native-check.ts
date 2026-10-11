import { expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import { PROVIDER_PATHS } from "../../web/src/lib/model-provider-icon-paths";

for (const provider of Object.keys(PROVIDER_PATHS)) {
  mock.module(resolve(import.meta.dir, `../assets/providers/provider-${provider}.png`), () => ({ uri: `provider:${provider}` }));
}
const { modelProviderIcon } = await import("../src/omg/model-provider-icons");

test("every web provider has its own mobile mark", () => {
  for (const provider of Object.keys(PROVIDER_PATHS)) {
    expect(modelProviderIcon(provider)).toEqual({ uri: `provider:${provider}` });
  }
});

test("mobile recognizes hosted provider slugs and does not assign unknown providers a mark", () => {
  expect(modelProviderIcon("X-AI")).toEqual({ uri: "provider:xai" });
  expect(modelProviderIcon("z-ai")).toEqual({ uri: "provider:zai" });
  for (const provider of [null, undefined, "", "unknown"]) expect(modelProviderIcon(provider)).toBeNull();
});
