// The catalog is only a claim about how a server authenticates. This test
// pins the projection the host reads: `needsOAuth` for an entry that says
// OAuth, and `authKind: null` for an entry that says nothing, which is the
// case the host must probe instead of trusting.
import { afterEach, expect, test } from "bun:test";
import { loadCatalog, RECOMMENDED_CATALOG, resetCatalogCacheForTests, searchCatalog, withRecommended } from "./catalog.ts";

const ENTRIES = [
  { id: "curated/exa-ai", slug: "exa-ai", name: "Exa", kind: "mcp", connectUrl: "https://mcp.exa.ai/mcp", auth: { kind: "none" } },
  { id: "mcp/nexafin", slug: "nexafin", name: "Nexafin", kind: "mcp", connectUrl: "https://app.nexafin.com/mcp", auth: { kind: "oauth" } },
  { id: "discovered/brex", slug: "brex", name: "Brex", kind: "mcp", connectUrl: "https://api.brex.com/mcp" },
  // Not MCP: an OpenAPI spec URL. Saving it as an endpoint fails on first use.
  { id: "openapi/google-gmail", slug: "google-gmail", name: "Gmail", kind: "openapi", connectUrl: "https://integrations.sh/specs/google/google-gmail.json" },
  { id: "cli/gh", slug: "gh", name: "GitHub CLI", kind: "cli", connectUrl: null },
];

const fakeFetch = (async () => Response.json({ integrations: ENTRIES })) as unknown as typeof fetch;

afterEach(() => resetCatalogCacheForTests());

test("projects the auth kind, and null when the entry carries none", async () => {
  const entries = await loadCatalog(true, fakeFetch);
  const bySlug = new Map(entries.map((e) => [e.slug, e]));

  expect(bySlug.get("exa-ai")?.authKind).toBe("none");
  expect(bySlug.get("exa-ai")?.needsOAuth).toBe(false);

  expect(bySlug.get("nexafin")?.authKind).toBe("oauth");
  expect(bySlug.get("nexafin")?.needsOAuth).toBe(true);

  // No `auth` at all: unknown, not open.
  expect(bySlug.get("brex")?.authKind).toBeNull();
  expect(bySlug.get("brex")?.needsOAuth).toBe(false);
});

test("search keeps the auth fields on the results", async () => {
  const entries = await loadCatalog(true, fakeFetch);
  const [hit] = searchCatalog(entries, "exa");
  expect(hit?.slug).toBe("exa-ai");
  expect(hit?.authKind).toBe("none");
});

test("only MCP entries are offered; OpenAPI specs and CLIs are dropped", async () => {
  const entries = await loadCatalog(true, fakeFetch);
  expect(entries.map((e) => e.slug).sort()).toEqual(["brex", "exa-ai", "nexafin"]);
  expect(searchCatalog(entries, "gmail")).toEqual([]);
});

test("the Google MCP servers are offered from the curated list, before the index", async () => {
  const entries = withRecommended(await loadCatalog(true, fakeFetch));
  const [gmail] = searchCatalog(entries, "gmail");
  expect(gmail?.connectUrl).toBe("https://gmailmcp.googleapis.com/mcp/v1");
  expect(gmail?.oauthApp).toBe("google");
  expect(gmail?.recommended).toBe(true);
  expect(entries.slice(0, RECOMMENDED_CATALOG.length)).toEqual(RECOMMENDED_CATALOG);
  expect(entries.filter((e) => e.slug === "exa-ai")).toHaveLength(1);
});
