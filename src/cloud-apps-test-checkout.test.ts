import { expect, test } from "bun:test";

import { handleCloudAppsRequest } from "./cloud-apps.ts";

// omg_app_test_checkout drives this one route; each action maps to one Cloud call.

async function call(body: unknown) {
  const sent: Array<{ method: string; url: string; body: unknown }> = [];
  const req = new Request("http://127.0.0.1/api/cloud/apps/test-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await handleCloudAppsRequest(req, new URL(req.url), {
    getAccessToken: async () => "tok",
    controlPlaneUrl: "https://backend.example",
    fetch: async (input, init) => {
      sent.push({ method: init?.method ?? "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true, slug: "shop", testMode: true }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return { status: response!.status, sent };
}

test("status, enable and disable address the app by slug", async () => {
  expect((await call({ action: "status", slug: "shop" })).sent).toEqual([
    { method: "GET", url: "https://backend.example/api/cli/apps/test-mode?slug=shop", body: null },
  ]);
  expect((await call({ action: "enable", slug: "shop" })).sent[0]).toMatchObject({
    method: "POST", url: "https://backend.example/api/cli/apps/test-mode", body: { slug: "shop", enabled: true },
  });
  expect((await call({ action: "disable", slug: "shop" })).sent[0].body).toEqual({ slug: "shop", enabled: false });
});

test("complete passes the checkout URL through", async () => {
  const url = "https://app.omg.dev/billing/test-checkout/abc";
  expect((await call({ action: "complete", checkout: url })).sent).toEqual([
    { method: "POST", url: "https://backend.example/api/cli/apps/test-checkout/complete", body: { checkout: url } },
  ]);
});

test("missing fields and unknown actions fail before Cloud", async () => {
  for (const body of [{ action: "complete" }, { action: "enable" }, { action: "nope", slug: "shop" }]) {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(res.sent).toHaveLength(0);
  }
});
