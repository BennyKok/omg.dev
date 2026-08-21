import type { McpServer } from "@agentclientprotocol/sdk";
import { omgMcpServers } from "../../config.ts";

/** Convert the shared managed-session MCP registration to ACP's wire shape. */
export function omgAcpMcpServers(sessionId: string): McpServer[] {
  const server = omgMcpServers(sessionId).mcpServers?.omg;
  if (!server) return [];
  return [{
    type: "http",
    name: "omg",
    url: server.url,
    headers: [],
  }];
}
