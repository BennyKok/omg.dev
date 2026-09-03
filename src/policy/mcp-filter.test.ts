import { describe, expect, test } from "bun:test";
import { enforceRole, policyToolId } from "./mcp-filter.ts";
import { OWNER_ROLE, type Role } from "./roles.ts";

const MARKETING: Role = {
  id: "marketing",
  name: "Marketing",
  defaultAction: "block",
  rules: [
    { pattern: "omg.ship", action: "allow" },
    { pattern: "omg.display_image", action: "allow" },
  ],
  sandbox: "none",
  createdAt: 0,
  updatedAt: 0,
};

const OMG = { namespace: "omg", strip: "omg_" };

function rpc(body: unknown): Request {
  return new Request("http://box/mcp?session=s1", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
}

const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
const TOOLS = [{ name: "omg_ship" }, { name: "omg_close_session" }, { name: "omg_display_image" }];

describe("policyToolId", () => {
  test("strips the server prefix and namespaces", () => {
    expect(policyToolId(OMG, "omg_ship")).toBe("omg.ship");
    expect(policyToolId({ namespace: "executor" }, "execute")).toBe("executor.execute");
  });
});

describe("enforceRole", () => {
  test("owner passes the request through untouched", async () => {
    const seen: string[] = [];
    const res = await enforceRole(rpc(LIST), OWNER_ROLE, OMG, async (r) => {
      seen.push(await r.text());
      return Response.json({ jsonrpc: "2.0", id: 1, result: { tools: TOOLS } });
    });
    expect(seen[0]).toContain("tools/list");
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools).toHaveLength(3);
  });

  test("tools/list JSON reply hides blocked tools", async () => {
    const res = await enforceRole(rpc(LIST), MARKETING, OMG, async () =>
      Response.json({ jsonrpc: "2.0", id: 1, result: { tools: TOOLS } }),
    );
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toEqual(["omg_ship", "omg_display_image"]);
  });

  test("tools/list SSE reply hides blocked tools frame by frame", async () => {
    const frame = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: TOOLS } });
    const res = await enforceRole(rpc(LIST), MARKETING, OMG, async () =>
      new Response(`event: message\ndata: ${frame}\n\n`, {
        headers: { "content-type": "text/event-stream", "mcp-session-id": "x" },
      }),
    );
    const text = await res.text();
    expect(text).toContain("omg_ship");
    expect(text).not.toContain("omg_close_session");
    expect(res.headers.get("mcp-session-id")).toBe("x");
  });

  test("tools/call on a blocked tool never reaches the server", async () => {
    let reached = false;
    const res = await enforceRole(
      rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "omg_close_session", arguments: {} } }),
      MARKETING,
      OMG,
      async () => {
        reached = true;
        return Response.json({});
      },
    );
    expect(reached).toBe(false);
    const body = (await res.json()) as { id: number; result: { isError: boolean; content: { text: string }[] } };
    expect(body.id).toBe(7);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain("Marketing");
  });

  test("tools/call on an allowed tool is forwarded with its body intact", async () => {
    let forwarded = "";
    await enforceRole(
      rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "omg_ship", arguments: { a: 1 } } }),
      MARKETING,
      OMG,
      async (r) => {
        forwarded = await r.text();
        return Response.json({});
      },
    );
    expect(forwarded).toContain('"a":1');
  });

  test("GET (event stream) is never buffered", async () => {
    const req = new Request("http://box/mcp?session=s1", { method: "GET" });
    const seen: Request[] = [];
    await enforceRole(req, MARKETING, OMG, async (r) => {
      seen.push(r);
      return new Response(null);
    });
    expect(seen[0]).toBe(req);
  });
});
