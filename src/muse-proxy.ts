// One egress knob for everything that talks to Meta on Muse Code's behalf.
//
// Meta gates its model catalog by request origin: the same credential lists
// muse-spark-1.3 from a Dutch residential address and only 1.2 from an Austrian
// datacenter (measured 2026-09-03). OMG_MUSE_PROXY names an HTTP CONNECT proxy
// that the muse CLI (reqwest: HTTPS_PROXY, no SOCKS), the headless runs, model
// discovery and the usage probe (Bun fetch: `proxy`) all go through, so the
// picker, the sessions and the rings agree on what Meta offers. Unset = direct.

export function museProxyUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.OMG_MUSE_PROXY?.trim();
  return raw && /^https?:\/\//.test(raw) ? raw : undefined;
}

/** The child environment for `muse serve` / `muse exec`: the CLI's own proxy variables, local traffic excluded. */
export function museChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const proxy = museProxyUrl(env);
  if (!proxy) return env;
  const noProxy = ["127.0.0.1", "localhost", env.NO_PROXY?.trim()].filter(Boolean).join(",");
  return { ...env, HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY: noProxy };
}

/** Bun `fetch` options carrying the same proxy, for the server's own Meta calls. */
export function museFetchInit(init: RequestInit = {}, env: NodeJS.ProcessEnv = process.env): RequestInit {
  const proxy = museProxyUrl(env);
  return proxy ? ({ ...init, proxy } as RequestInit) : init;
}
