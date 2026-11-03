import { describe, expect, test } from "bun:test";
import { omgMcpServers } from "./config.ts";

describe("omgMcpServers", () => {
  const originalSessionId = process.env.LFG_SESSION_ID;
  const originalBase = process.env.LFG_BASE;

  function restore() {
    if (originalSessionId === undefined) delete process.env.LFG_SESSION_ID;
    else process.env.LFG_SESSION_ID = originalSessionId;
    if (originalBase === undefined) delete process.env.LFG_BASE;
    else process.env.LFG_BASE = originalBase;
  }

  test("names the session in the endpoint URL", () => {
    process.env.LFG_BASE = "http://127.0.0.1:8766";
    try {
      const servers = omgMcpServers("ba4522bc-6607-4691-b69e-8b99cfb3ead2").mcpServers!;
      // The per-session token (src/policy/session-token.ts); box-specific.
      const headers = { "x-omg-session-token": expect.any(String) };
      expect(servers.omg).toEqual({
        type: "http",
        url: "http://127.0.0.1:8766/mcp?session=ba4522bc-6607-4691-b69e-8b99cfb3ead2",
        headers,
      });
      // The native connector surface is registered alongside omg.
      expect(servers.connectors).toEqual({
        type: "http",
        url: "http://127.0.0.1:8766/mcp/connectors?session=ba4522bc-6607-4691-b69e-8b99cfb3ead2",
        headers,
      });
    } finally {
      restore();
    }
  });

  test("falls back to the ambient session when the caller passes none", () => {
    process.env.LFG_BASE = "http://127.0.0.1:8766";
    process.env.LFG_SESSION_ID = "ambient-session";
    try {
      expect(omgMcpServers().mcpServers?.omg.url).toContain("session=ambient-session");
    } finally {
      restore();
    }
  });

  test("registers nothing outside a managed session", () => {
    delete process.env.LFG_SESSION_ID;
    try {
      // An empty object leaves the user-scope registration in charge rather
      // than pointing the agent at a URL naming no session.
      expect(omgMcpServers()).toEqual({});
      expect(omgMcpServers("   ")).toEqual({});
    } finally {
      restore();
    }
  });
});
