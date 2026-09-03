// Calls into the Executor daemon's own HTTP API, on behalf of the omg UI.
//
// The Settings control plane edits box-level Executor policies and reads its
// tool catalog without the browser ever holding the daemon's bearer: omg
// forwards a small allowlist of routes and injects the token here. Anything
// outside the allowlist is refused, so this is not a general proxy.
import { executorAuth } from "./daemon.ts";

const ALLOWED: { method: string; pattern: RegExp }[] = [
  { method: "GET", pattern: /^\/policies$/ },
  { method: "POST", pattern: /^\/policies$/ },
  { method: "PATCH", pattern: /^\/policies\/[A-Za-z0-9_-]+$/ },
  { method: "DELETE", pattern: /^\/policies\/[A-Za-z0-9_-]+$/ },
  { method: "GET", pattern: /^\/tools$/ },
  { method: "GET", pattern: /^\/integrations$/ },
  { method: "GET", pattern: /^\/connections$/ },
];

export function executorApiAllowed(method: string, path: string): boolean {
  return ALLOWED.some((rule) => rule.method === method && rule.pattern.test(path));
}

/**
 * Forward one `/api/executor/api/<path>` request to the daemon's `/api/<path>`.
 * `upstream` and `fetchImpl` are injectable for tests.
 */
export async function forwardExecutorApi(
  req: Request,
  path: string,
  upstream: { origin: string; token: string } | null = executorAuth(),
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!executorApiAllowed(req.method, path)) {
    return Response.json({ error: "not a forwarded Executor route" }, { status: 403 });
  }
  if (!upstream) {
    return Response.json({ error: "the connector gateway is not running" }, { status: 503 });
  }
  const url = new URL(req.url);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const res = await fetchImpl(`${upstream.origin}/api${path}${url.search}`, {
      method: req.method,
      headers: {
        authorization: `Bearer ${upstream.token}`,
        accept: "application/json",
        ...(hasBody ? { "content-type": req.headers.get("content-type") ?? "application/json" } : {}),
      },
      body: hasBody ? await req.text() : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(res.body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "the connector gateway is unreachable" }, { status: 502 });
  }
}
