import type { McpServer } from "@agentclientprotocol/sdk";
import { omgMcpServers } from "../../config.ts";

/** The omg-served MCP endpoints for one session, in ACP's server shape. */
export function omgAcpMcpServers(sessionId: string): McpServer[] {
  const servers = omgMcpServers(sessionId).mcpServers ?? {};
  return Object.entries(servers).map(([name, server]) => ({
    type: "http",
    name,
    url: server.url,
    headers: Object.entries(server.headers).map(([hname, value]) => ({ name: hname, value })),
  }));
}
