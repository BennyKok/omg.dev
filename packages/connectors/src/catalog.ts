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
  /**
   * The catalog's own `auth.kind` ("none", "oauth", "api_key", ...), or null
   * when the entry carries no auth metadata at all. Null means unknown, not
   * "no auth": about half of the MCP entries say nothing, so the host probes
   * the endpoint instead of trusting the catalog.
   */
  authKind: string | null;
  /** Sign in with this provider's pre-registered client (./oauth-apps.ts). */
  oauthApp?: string;
  /** Shown above the searchable catalog. Only curated entries set it. */
  recommended?: boolean;
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
  const rawAuth = r.auth;
  const auth = JSON.stringify(rawAuth ?? "").toLowerCase();
  const authKind =
    rawAuth && typeof rawAuth === "object" && typeof (rawAuth as { kind?: unknown }).kind === "string"
      ? ((rawAuth as { kind: string }).kind as string)
      : typeof rawAuth === "string" && rawAuth
        ? rawAuth
        : null;
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
    authKind,
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
    // The hub speaks MCP only. The index also lists OpenAPI specs, CLIs and
    // GraphQL schemas; offering those would save a spec URL as an MCP endpoint
    // and fail with a JSON-RPC parse error on first use.
    const entries = (list as unknown[])
      .map(project)
      .filter((e): e is CatalogEntry => e !== null && e.kind === "mcp");
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

const G = "https://fonts.gstatic.com/s/i/productlogos";
function google(slug: string, name: string, host: string, description: string, icon: string): CatalogEntry {
  return {
    id: `omg/google-${slug}`,
    slug: `google-${slug}`,
    name,
    description,
    kind: "mcp",
    categories: ["google"],
    connectUrl: `https://${host}.googleapis.com/mcp/v1`,
    icon,
    domain: `${host}.googleapis.com`,
    needsOAuth: true,
    authKind: "oauth",
    oauthApp: "google",
    recommended: true,
  };
}

/**
 * Entries omg curates itself, because the public index does not carry them as
 * MCP servers. Google's official MCP servers sign in with a pre-registered
 * client, not dynamic registration, so each one names the "google" app.
 */
export const RECOMMENDED_CATALOG: CatalogEntry[] = [
  google("gmail", "Gmail", "gmailmcp", "Search, read, draft, label and trash mail.", `${G}/gmail_2020q4/v8/web-96dp/logo_gmail_2020q4_color_2x_web_96dp.png`),
  google("calendar", "Google Calendar", "calendarmcp", "Read and manage calendar events.", `${G}/calendar_2020q4/v8/web-96dp/logo_calendar_2020q4_color_2x_web_96dp.png`),
  google("drive", "Google Drive", "drivemcp", "Search and read files in Drive.", `${G}/drive_2020q4/v8/web-96dp/logo_drive_2020q4_color_2x_web_96dp.png`),
  google("docs", "Google Docs", "docsmcp", "Read and edit documents.", `${G}/docs_2020q4/v12/web-96dp/logo_docs_2020q4_color_2x_web_96dp.png`),
  google("sheets", "Google Sheets", "sheetsmcp", "Read and edit spreadsheets.", `${G}/sheets_2020q4/v8/web-96dp/logo_sheets_2020q4_color_2x_web_96dp.png`),
  google("slides", "Google Slides", "slidesmcp", "Read and edit presentations.", `${G}/slides_2020q4/v12/web-96dp/logo_slides_2020q4_color_2x_web_96dp.png`),
  google("chat", "Google Chat", "chatmcp", "Read and send messages in Chat spaces.", `${G}/chat_2020q4/v8/web-96dp/logo_chat_2020q4_color_2x_web_96dp.png`),
  google("people", "Google Contacts", "people", "Look up contacts and directory people.", `${G}/contacts_2022/v1/web-96dp/logo_contacts_2022_color_2x_web_96dp.png`),
];

/** The curated entries first, then the index, without a second copy of an endpoint. */
export function withRecommended(entries: CatalogEntry[]): CatalogEntry[] {
  const curated = new Set(RECOMMENDED_CATALOG.map((e) => e.connectUrl));
  return [...RECOMMENDED_CATALOG, ...entries.filter((e) => !curated.has(e.connectUrl))];
}
