// The agent-facing connector endpoint: `/mcp/executor`.
//
// A transparent Streamable HTTP proxy in front of the Executor daemon. Agents
// register this URL and nothing else; the daemon's port and bearer token stay
// inside the serve process. Passing the daemon's own `/mcp` straight through,
// rather than re-describing its tools through an MCP client, keeps omg out of
// the schema business and gives the role filter (phase 2 of
// docs/team-tooling-design.md) one place to read and rewrite JSON-RPC bodies.
//
// Streamable HTTP is stateful: the daemon issues an `mcp-session-id` on
// initialize and expects it back on every later request, and GET opens a
// long-lived event stream. Both headers therefore pass in both directions and
// the response body is streamed, never buffered.
import { executorAuth } from "./daemon.ts";

// Request headers the daemon needs to see. Everything else, including the
// agent's own Authorization header if it sent one, is dropped.
const FORWARD_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];

// Response headers the agent needs to see.
const FORWARD_RESPONSE_HEADERS = ["content-type", "mcp-session-id", "mcp-protocol-version"];

export type ExecutorUpstream = { origin: string; token: string };

/**
 * Answer one `/mcp/executor` request by forwarding it to the daemon.
 *
 * `upstream` is injectable for tests; production callers leave it to the
 * daemon owner. A missing upstream is a 503, not a 404: the endpoint exists
 * and is enabled, the process behind it is not up yet.
 */
export async function serveExecutorMcpRequest(
  req: Request,
  upstream: ExecutorUpstream | null = executorAuth(),
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!upstream) {
    return Response.json(
      { error: "the connector gateway is not running" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${upstream.token}`);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let res: Response;
  try {
    res = await fetchImpl(`${upstream.origin}/mcp`, {
      method: req.method,
      headers,
      // JSON-RPC request bodies are small; the long-lived direction is the
      // response stream, which is passed through below.
      body: hasBody ? await req.arrayBuffer() : undefined,
    });
  } catch {
    return Response.json(
      { error: "the connector gateway is unreachable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const out = new Headers({ "Cache-Control": "no-store" });
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = res.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers: out });
}
