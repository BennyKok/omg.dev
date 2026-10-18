import { expect, test } from "bun:test";
import { inlinePreviewUrl, sameSitePreviewUrl } from "./project-preview";

const web = { url: "https://abc123-5173.preview.omgs.app/todos?x=1#top" };

test("an omg.dev page frames a web preview through the same-site host", () => {
  for (const page of ["app.omg.dev", "omg.dev", "APP.OMG.DEV"]) {
    expect(inlinePreviewUrl(web, page)).toBe("https://abc123-5173.preview.omg.dev/todos?x=1#top");
  }
});

test("other pages keep the canonical preview host", () => {
  for (const page of ["", "sessions.omgs.app", "127.0.0.1", "evil-omg.dev", "omg.dev.example.com"]) {
    expect(inlinePreviewUrl(web, page)).toBe(web.url);
  }
});

test("only canonical https preview hosts are rewritten", () => {
  for (const url of ["https://my-app.omgs.app/", "http://abc-5173.preview.omgs.app/", "https://abc-5173.preview.omg.dev/", "https://example.com/", "not a url"]) {
    expect(sameSitePreviewUrl(url, "app.omg.dev")).toBe(url);
  }
});

test("the Expo capability host is unchanged", () => {
  expect(inlinePreviewUrl({ url: "https://abc-8081.preview.omgs.app/", expoGoUrl: "exps://abc-8081-1-ff.preview.omgs.app" }, "app.omg.dev"))
    .toBe("https://abc-8081-1-ff.preview.omgs.app");
});
