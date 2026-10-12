// omg_app_identity over MCP: the store screenshots field.
//
// Fails if the agent cannot pass its screenshots (the store page keeps showing
// design mockups), if the order is lost, or if more than 5 or non-https
// links reach Cloud.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { serveOmgMcpRequest } from "../src/mcp-http.ts";

const originalFetch = globalThis.fetch;
const originalBase = process.env.LFG_BASE;
let calls: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  calls = [];
  process.env.LFG_BASE = "http://127.0.0.1:9876";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: JSON.parse(String(init?.body ?? "null")) });
    return Response.json({ ok: true, slug: "hi", name: "Hi", tagline: null, iconUrl: null, screenshots: [] });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBase === undefined) delete process.env.LFG_BASE;
  else process.env.LFG_BASE = originalBase;
});

async function rpc(method: string, params: unknown): Promise<any> {
  const res = await serveOmgMcpRequest(
    new Request("http://127.0.0.1:8766/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return ((await res.json()) as { result?: unknown }).result;
}

test("the tool lists screenshotUrls as an ordered list of at most 5 links", async () => {
  const { tools } = await rpc("tools/list", {});
  const tool = tools.find((t: { name: string }) => t.name === "omg_app_identity");
  const field = tool.inputSchema.properties.screenshotUrls;
  expect(field.type).toBe("array");
  expect(field.items.type).toBe("string");
  expect(field.maxItems).toBe(5);
  expect(tool.inputSchema.required).toEqual(["slug"]);
});

test("the screenshot links reach the identity route in order, and [] is sent to clear", async () => {
  const urls = ["https://hi.omgs.app/store/1.png", "https://hi.omgs.app/store/2.png", "https://hi.omgs.app/store/3.png"];
  const out = await rpc("tools/call", { name: "omg_app_identity", arguments: { slug: "hi", screenshotUrls: urls } });
  expect(out.isError).not.toBe(true);
  await rpc("tools/call", { name: "omg_app_identity", arguments: { slug: "hi", screenshotUrls: [] } });
  expect(calls).toEqual([
    { url: "http://127.0.0.1:9876/api/cloud/apps/identity", method: "POST", body: { slug: "hi", screenshotUrls: urls } },
    { url: "http://127.0.0.1:9876/api/cloud/apps/identity", method: "POST", body: { slug: "hi", screenshotUrls: [] } },
  ]);
});

test("six links, an http link or a file path are refused before any request", async () => {
  const six = [1, 2, 3, 4, 5, 6].map((n) => `https://hi.omgs.app/store/${n}.png`);
  for (const screenshotUrls of [six, ["http://hi.omgs.app/store/1.png"], ["/w/home.png"]]) {
    const out = await rpc("tools/call", { name: "omg_app_identity", arguments: { slug: "hi", screenshotUrls } });
    expect(out.isError).toBe(true);
  }
  expect(calls).toEqual([]);
});
