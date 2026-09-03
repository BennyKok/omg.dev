// Calls into the Executor daemon's own HTTP API, on behalf of the omg UI.
//
// The Settings control plane edits box-level Executor policies and reads its
// tool catalog without the browser ever holding the daemon's bearer: omg
// forwards a small allowlist of routes and injects the token here. Anything
// outside the allowlist is refused, so this is not a general proxy.
import { executorAuth } from "./daemon.ts";

// One connection is addressed by three path segments (owner/integration/name).
// Segments are slugs: letters, digits, dot, dash, underscore.
const SEG = "[A-Za-z0-9._-]+";

const ALLOWED: { method: string; pattern: RegExp }[] = [
  // Box-wide tool policies.
  { method: "GET", pattern: /^\/policies$/ },
  { method: "POST", pattern: /^\/policies$/ },
  { method: "PATCH", pattern: /^\/policies\/[A-Za-z0-9_-]+$/ },
  { method: "DELETE", pattern: /^\/policies\/[A-Za-z0-9_-]+$/ },
  // Catalog reads.
  { method: "GET", pattern: /^\/tools$/ },
  { method: "GET", pattern: /^\/integrations$/ },
  { method: "GET", pattern: new RegExp(`^/integrations/${SEG}$`) },
  // Connections: the native Integrations panel lists, inspects, adds
  // (API-key style), refreshes, and removes them.
  { method: "GET", pattern: /^\/connections$/ },
  { method: "POST", pattern: /^\/connections$/ },
  { method: "GET", pattern: new RegExp(`^/connections/${SEG}/${SEG}/${SEG}$`) },
  { method: "PATCH", pattern: new RegExp(`^/connections/${SEG}/${SEG}/${SEG}$`) },
  { method: "DELETE", pattern: new RegExp(`^/connections/${SEG}/${SEG}/${SEG}$`) },
  { method: "POST", pattern: new RegExp(`^/connections/${SEG}/${SEG}/${SEG}/refresh$`) },
];

export function executorApiAllowed(method: string, path: string): boolean {
  return ALLOWED.some((rule) => rule.method === method && rule.pattern.test(path));
}

// Management tools the native UI may run (add a source, inspect one). These
// are catalog operations, not agent tools; running them from Settings is the
// operator adding an integration, so they run with autoApprove. Anything not
// on this list is refused — this is not a way to run arbitrary code.
export const MANAGEMENT_TOOLS = new Set([
  "executor.openapi.addSpec",
  "executor.openapi.previewSpec",
  "executor.mcp.addServer",
  "executor.mcp.probeEndpoint",
]);

export function managementToolAllowed(address: string): boolean {
  return MANAGEMENT_TOOLS.has(address);
}

export type ManagementResult =
  | { ok: true; status: "completed" | "paused"; text: string; structured: unknown; isError: boolean }
  | { ok: false; error: string };

/**
 * Run one allowlisted management tool through the daemon's execute REST, with
 * the bearer injected. autoApprove is set because the operator clicking "Add"
 * in Settings is the approval; a `block` policy still stops it.
 */
export async function runManagementTool(
  address: string,
  input: unknown,
  upstream: { origin: string; token: string } | null = executorAuth(),
  fetchImpl: typeof fetch = fetch,
): Promise<ManagementResult> {
  if (!managementToolAllowed(address)) return { ok: false, error: `tool "${address}" is not a management tool` };
  if (!upstream) return { ok: false, error: "the connector gateway is not running" };
  // The execute sandbox has no JSON literal injection risk: input is embedded
  // as a JSON literal, which is valid TypeScript, and the address is
  // allowlisted so it cannot be an arbitrary expression.
  const code = `return await tools.${address}(${JSON.stringify(input ?? {})});`;
  try {
    const res = await fetchImpl(`${upstream.origin}/api/executions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${upstream.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ code, autoApprove: true }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json().catch(() => null)) as
      | { status?: string; text?: string; structured?: unknown; isError?: boolean; message?: string; _tag?: string }
      | null;
    if (!res.ok) return { ok: false, error: body?.message || body?._tag || `status ${res.status}` };
    return {
      ok: true,
      status: body?.status === "paused" ? "paused" : "completed",
      text: body?.text ?? "",
      structured: body?.structured ?? null,
      isError: body?.isError === true,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "the connector gateway is unreachable" };
  }
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
