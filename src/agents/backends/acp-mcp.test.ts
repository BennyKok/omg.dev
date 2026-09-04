import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { omgAcpMcpServers } from "./acp-mcp.ts";

describe("omgAcpMcpServers", () => {
  const originalPort = process.env.LFG_PORT;

  beforeEach(() => {
    process.env.LFG_PORT = "4567";
  });

  afterEach(() => {
    if (originalPort == null) delete process.env.LFG_PORT;
    else process.env.LFG_PORT = originalPort;
  });

  test("includes the managed session identity in the ACP HTTP registration", () => {
    const servers = omgAcpMcpServers("session with spaces");
    // The session token that lets this session claim its own id at the
    // endpoint (src/policy/session-token.ts). Value is box-specific.
    const headers = [{ name: "x-omg-session-token", value: expect.any(String) }];
    expect(servers).toContainEqual({
      type: "http",
      name: "omg",
      url: "http://127.0.0.1:4567/mcp?session=session%20with%20spaces",
      headers,
    });
    // The native connector surface is always offered alongside omg.
    expect(servers).toContainEqual({
      type: "http",
      name: "connectors",
      url: "http://127.0.0.1:4567/mcp/connectors?session=session%20with%20spaces",
      headers,
    });
  });
});
