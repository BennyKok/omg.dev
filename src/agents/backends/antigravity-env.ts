// Environment for every `agy` process omg.dev starts (sessions, the status
// probe, and login).
//
// LFG_ANTIGRAVITY_PROXY names a local HTTPS proxy for Antigravity alone. A box
// whose default internet exit Google rejects for Gemini ("User location is not
// supported") can run a proxy that sends only Google's Gemini hosts out
// another way, without moving any other agent off its normal route. Setting
// HTTPS_PROXY for the whole service instead would send Claude, Codex and
// everything else through that proxy too.
//
// Only a loopback proxy is accepted: agy's traffic carries its Google
// credentials, so this setting must never point it at another machine.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const NO_PROXY_LOCAL = ["127.0.0.1", "localhost", "::1"];

/** The configured proxy URL, or null when unset or not a loopback http URL. */
export function antigravityProxyUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.LFG_ANTIGRAVITY_PROXY?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * `base` plus the proxy variables agy reads. The local omg.dev server (MCP
 * endpoint) stays direct through NO_PROXY. Without a valid proxy setting the
 * environment is returned unchanged.
 */
export function antigravityEnv(
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const proxy = antigravityProxyUrl(base);
  if (!proxy) return base;
  const noProxy = [base.NO_PROXY ?? base.no_proxy ?? "", ...NO_PROXY_LOCAL]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const joined = [...new Set(noProxy)].join(",");
  return { ...base, HTTPS_PROXY: proxy, https_proxy: proxy, NO_PROXY: joined, no_proxy: joined };
}
