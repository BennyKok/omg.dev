// The connector catalog: the same list Executor draws from, fetched by omg so
// a member can browse and add from it natively. Source of truth is the public
// integrations.sh index (overridable for tests / air-gapped installs).
//
// Cached in memory with a TTL, because it is ~5k entries and rarely changes.
// A fetch failure returns the last good copy when there is one.
export const DEFAULT_CATALOG_URL = "https://integrations.sh/api.json";

export interface CatalogEntry {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: string;
  categories: string[];
  connectUrl: string | null;
  /** Logo URL for the integration, when the catalog carries one. */
  icon: string | null;
  domain: string | null;
  /** True when connecting needs OAuth, which is not yet supported end to end. */
  needsOAuth: boolean;
}

const TTL_MS = 60 * 60 * 1000;
let cache: { at: number; entries: CatalogEntry[] } | null = null;

function catalogUrl(): string {
  return process.env.OMG_CONNECTOR_CATALOG_URL?.trim() || DEFAULT_CATALOG_URL;
}

function project(raw: unknown): CatalogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = typeof r.slug === "string" ? r.slug : typeof r.id === "string" ? r.id : "";
  if (!slug) return null;
  const auth = JSON.stringify(r.auth ?? "").toLowerCase();
  return {
    id: typeof r.id === "string" ? r.id : slug,
    slug,
    name: typeof r.name === "string" ? r.name : slug,
    description: typeof r.description === "string" ? r.description : "",
    kind: typeof r.kind === "string" ? r.kind : "",
    categories: Array.isArray(r.categories) ? r.categories.filter((c): c is string => typeof c === "string") : [],
    connectUrl: typeof r.connectUrl === "string" ? r.connectUrl : null,
    icon: typeof r.icon === "string" ? r.icon : null,
    domain: typeof r.domain === "string" ? r.domain : null,
    needsOAuth: auth.includes("oauth"),
  };
}

export async function loadCatalog(force = false, fetchImpl: typeof fetch = fetch): Promise<CatalogEntry[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.entries;
  try {
    const res = await fetchImpl(catalogUrl(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`catalog fetch failed (${res.status})`);
    const json = (await res.json()) as unknown;
    const list = Array.isArray(json)
      ? json
      : ((json as { integrations?: unknown[]; items?: unknown[]; data?: unknown[] }).integrations ??
        (json as { items?: unknown[] }).items ??
        (json as { data?: unknown[] }).data ??
        []);
    const entries = (list as unknown[]).map(project).filter((e): e is CatalogEntry => e !== null);
    cache = { at: Date.now(), entries };
    return entries;
  } catch (e) {
    if (cache) return cache.entries;
    throw e;
  }
}

/** A ranked, capped search over the catalog for the browse UI. */
export function searchCatalog(entries: CatalogEntry[], query: string, limit = 50): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, limit);
  const scored: { e: CatalogEntry; score: number }[] = [];
  for (const e of entries) {
    const name = e.name.toLowerCase();
    const slug = e.slug.toLowerCase();
    let score = 0;
    if (name === q || slug === q) score = 100;
    else if (name.startsWith(q) || slug.startsWith(q)) score = 80;
    else if (name.includes(q) || slug.includes(q)) score = 60;
    else if (e.description.toLowerCase().includes(q) || e.categories.some((c) => c.toLowerCase().includes(q))) score = 30;
    if (score > 0) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, limit).map((s) => s.e);
}

export function resetCatalogCacheForTests(): void {
  cache = null;
}
