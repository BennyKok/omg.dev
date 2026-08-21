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
    expect(omgAcpMcpServers("session with spaces")).toEqual([{
      type: "http",
      name: "omg",
      url: "http://127.0.0.1:4567/mcp?session=session%20with%20spaces",
      headers: [],
    }]);
  });
});
