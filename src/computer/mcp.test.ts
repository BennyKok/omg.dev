import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { serveComputerMcpRequest } from "../mcp-http.ts";

const originalFetch = globalThis.fetch;
const originalBase = process.env.LFG_BASE;

beforeEach(() => {
  process.env.LFG_BASE = "http://127.0.0.1:9876";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBase === undefined) delete process.env.LFG_BASE;
  else process.env.LFG_BASE = originalBase;
});

async function rpc(method: string, params: unknown) {
  const response = await serveComputerMcpRequest(
    new Request("http://127.0.0.1:8766/computer-mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return (await response.json()) as {
    result?: {
      tools?: Array<{ name: string }>;
      content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    };
  };
}

describe("Computer inspection MCP", () => {
  test("advertises inspect and cancel only in the Computer catalog", async () => {
    const body = await rpc("tools/list", {});
    const names = body.result?.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain("computer_inspect");
    expect(names).toContain("computer_inspect_cancel");
  });

  test("returns inspection details and its cropped PNG as separate MCP content", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return Response.json({
        status: "selected",
        selector: "#buy",
        screenshotBase64: "cG5n",
      });
    }) as typeof fetch;

    const body = await rpc("tools/call", {
      name: "computer_inspect",
      arguments: { timeoutSeconds: 45 },
    });

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:9876/api/computer/browser/inspect",
        body: { timeoutMs: 45_000 },
      },
    ]);
    expect(body.result?.content?.[0]).toEqual({
      type: "text",
      text: JSON.stringify({ status: "selected", selector: "#buy" }),
    });
    expect(body.result?.content?.[1]).toEqual({
      type: "image",
      data: "cG5n",
      mimeType: "image/png",
    });
  });
});
