import { expect, test } from "bun:test";

import { handleCloudAppsRequest } from "./cloud-apps.ts";

// omg_app_payments drives this one route. Turning payments on must carry the
// terms version the owner accepted, so Cloud can refuse a stale acceptance.

async function call(body: unknown) {
  const sent: Array<{ method: string; url: string; body: unknown }> = [];
  const req = new Request("http://127.0.0.1/api/cloud/apps/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await handleCloudAppsRequest(req, new URL(req.url), {
    getAccessToken: async () => "tok",
    controlPlaneUrl: "https://backend.example",
    fetch: async (input, init) => {
      sent.push({ method: init?.method ?? "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ slug: "shop", enabled: true }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return { status: response!.status, sent };
}

test("status reads the app's payments by slug", async () => {
  expect((await call({ action: "status", slug: "shop" })).sent).toEqual([
    { method: "GET", url: "https://backend.example/api/cli/apps/payments?slug=shop", body: null },
  ]);
});

test("enable sends the accepted terms version, and disable turns payments off", async () => {
  expect((await call({ action: "enable", slug: "shop", acceptTermsVersion: "2026-10-26" })).sent).toEqual([
    {
      method: "POST",
      url: "https://backend.example/api/cli/apps/payments",
      body: { slug: "shop", action: "enable", acceptTermsVersion: "2026-10-26" },
    },
  ]);
  expect((await call({ action: "disable", slug: "shop" })).sent[0].body).toEqual({ slug: "shop", action: "disable" });
});

test("enable without an accepted terms version never reaches Cloud", async () => {
  for (const body of [
    { action: "enable", slug: "shop" },
    { action: "enable", slug: "shop", acceptTermsVersion: " " },
    { action: "status" },
    { action: "nope", slug: "shop" },
  ]) {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(res.sent).toHaveLength(0);
  }
});
