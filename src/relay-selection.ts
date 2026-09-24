export interface RelayCandidate { id: string; connectUrl: string }
export function relayHttpEndpoint(connectUrl: string, suffix: string): string {
  const url = new URL(connectUrl.endsWith("/") ? connectUrl : `${connectUrl}/`);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return new URL(suffix, url).href;
}
export function readRelayCandidates(value: unknown): RelayCandidate[] {
  if (!Array.isArray(value) || value.length > 8) return [];
  return value.filter((r): r is RelayCandidate => {
    if (!r || typeof r.id !== "string" || typeof r.connectUrl !== "string") return false;
    try { const u = new URL(r.connectUrl); return u.protocol === "wss:" && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
  });
}
/** Probe without credentials. Keep a healthy incumbent when the gain is below 20 ms. */
export async function selectRelay(
  fallback: string,
  cached: RelayCandidate[] = [],
  options: { fetch?: typeof fetch; now?: () => number; avoid?: string } = {},
): Promise<{ url: string; candidates: RelayCandidate[]; latencyMs: number | null }> {
  const request = options.fetch ?? fetch;
  const now = options.now ?? performance.now.bind(performance);
  let candidates = readRelayCandidates(cached);
  try {
    const response = await request(relayHttpEndpoint(fallback, "regions"), { signal: AbortSignal.timeout(2000), redirect: "error" });
    if (response.ok) {
      const body = await response.json() as { regions?: unknown };
      const discovered = readRelayCandidates(body.regions);
      if (discovered.length) candidates = discovered;
    }
  } catch { /* retained discovery permits failover while the authority is unreachable */ }
  const measured = await Promise.all(candidates.filter(r => r.connectUrl !== options.avoid).map(async candidate => {
    const times: number[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const start = now();
        const r = await request(relayHttpEndpoint(candidate.connectUrl, "probe"), { signal: AbortSignal.timeout(1200), cache: "no-store", redirect: "error" });
        await r.arrayBuffer();
        if (!r.ok) return null;
        times.push(now() - start);
      }
    } catch { return null; }
    times.sort((a, b) => a - b);
    return { url: candidate.connectUrl, latencyMs: times[1]! };
  }));
  const healthy = measured.filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => a.latencyMs - b.latencyMs);
  let best = healthy[0];
  const incumbent = healthy.find(r => r.url === fallback);
  if (best && incumbent && incumbent.latencyMs - best.latencyMs < 20) best = incumbent;
  return { url: best?.url ?? fallback, latencyMs: best?.latencyMs ?? null, candidates };
}
