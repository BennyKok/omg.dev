import { expect, test } from "bun:test";
import { authenticatedPreviewUrl, mintPreviewAppToken, previewAuthRequest } from "./preview-auth";
const identity = { appId: "my-app", projectId: "project" };
test("bootstrap stays in a fragment and preserves the preview origin", () => {
  const url = new URL(authenticatedPreviewUrl("https://test-8081.preview.omgs.app/?route=home", "my-app", "scoped-token"));
  expect(url.origin).toBe("https://test-8081.preview.omgs.app");
  expect(url.search).toBe("?route=home");
  expect(JSON.parse(new URLSearchParams(url.hash.slice(1)).get("__omg_preview_auth")!)).toEqual({ appId: "my-app", token: "scoped-token", parentOrigin: "https://app.omg.dev" });
  expect(url.href.split("#")[0]).not.toContain("scoped-token");
});
test("anonymous never asks the auth service to mint", async () => {
  let calls = 0;
  expect(await mintPreviewAppToken(identity, { getAccessToken: async () => null, fetch: async () => { calls++; return Response.json({}); } })).toBeNull();
  expect(calls).toBe(0);
});
test("never hands app credentials to arbitrary or non-Metro origins", () => {
  for (const url of ["https://attacker.example/", "https://test-5173.preview.omgs.app/", "http://test-8081.preview.omgs.app/"]) {
    expect(() => authenticatedPreviewUrl(url, "my-app", "token")).toThrow();
  }
});
test.each([403, 404])("permission rejection %d prevents app mint", async status => {
  let calls = 0;
  expect(await mintPreviewAppToken(identity, { getAccessToken: async () => "dashboard-token", fetch: async () => { calls++; return new Response("denied", { status }); } })).toBeNull();
  expect(calls).toBe(1);
});
test("wrong app permission response prevents mint", async () => {
  let calls = 0;
  expect(await mintPreviewAppToken(identity, { getAccessToken: async () => "dashboard-token", fetch: async () => { calls++; return Response.json({ appId: "other-app" }); } })).toBeNull();
  expect(calls).toBe(1);
});
test("only owner-scoped permission leads to a token and dashboard bearer stays on control plane", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const token = await mintPreviewAppToken(identity, { getAccessToken: async () => "dashboard-token", fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(calls.length === 1 ? { appId: "my-app" } : { token: "app-token" });
  } });
  expect(token).toBe("app-token");
  expect(calls[0]).toEqual({ url: "https://backend.omg.dev/api/projects/previewAuthContext", init: expect.objectContaining({ credentials: "omit", headers: { "Content-Type": "application/json", Authorization: "Bearer dashboard-token" }, body: JSON.stringify(identity) }) });
  expect(calls[1]).toEqual({ url: "https://auth.omg.dev/token", init: expect.objectContaining({ credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: "my-app" }) }) });
});
test("renewal messages require the intended app and bounded nonce", () => {
  const request = { type: "omg:preview-auth:request", appId: "my-app", requestId: "nonce" };
  expect(previewAuthRequest(request, "my-app")).toEqual({ appId: "my-app", requestId: "nonce" });
  expect(previewAuthRequest(request, "other-app")).toBeNull();
  expect(previewAuthRequest({ ...request, requestId: "" }, "my-app")).toBeNull();
  expect(previewAuthRequest({ ...request, requestId: "a".repeat(101) }, "my-app")).toBeNull();
  expect(previewAuthRequest({ ...request, type: "omg:preview-auth:response" }, "my-app")).toBeNull();
});
