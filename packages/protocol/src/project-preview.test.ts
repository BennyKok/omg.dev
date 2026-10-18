import { expect, test } from "bun:test";
import { inlinePreviewUrl } from "./project-preview";

// Fails if the inline frame stops loading the signed host (it would load the
// cookie URL that loops on iOS), or keeps loading one after it expired.
test("the inline frame loads the signed frame host until it expires", () => {
  const preview = {
    url: "https://sb-5173.preview.omgs.app",
    frameUrl: "https://sb-5173-abc-0123.preview.omgs.app",
    frameUrlExpiresAt: 2_000,
  };
  expect(inlinePreviewUrl(preview, 1_000)).toBe(preview.frameUrl);
  expect(inlinePreviewUrl(preview, 2_000)).toBe(preview.url);
  expect(inlinePreviewUrl({ url: preview.url }, 1_000)).toBe(preview.url);
  expect(inlinePreviewUrl({ ...preview, expoGoUrl: "exps://sb-8081-abc-0123.preview.omgs.app" }, 1_000))
    .toBe("https://sb-8081-abc-0123.preview.omgs.app");
});
