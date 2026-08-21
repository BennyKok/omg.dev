import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_HOSTS,
  INDEXNOW_KEY,
  INDEXNOW_KEY_FILE,
  PUBLIC_SITEMAPS,
  buildIndexNowPayloads,
  checkKeyLocationServed,
  collectSitemapUrls,
  dedupeUrls,
  filterPublicIndexNowUrls,
  isPublicIndexNowUrl,
  isValidIndexNowKey,
  keyLocationFor,
  locTags,
  parseSubmitArgs,
  pingIndexNow,
  readCommittedIndexNowKey,
  shouldPostIndexNow,
} from "./indexnow.ts";
import { main, submitIndexNow, submitSitemapsToGsc } from "./gsc-submit-sitemaps.ts";

const APEX = "https://omg.dev/pricing";
const DOCS = "https://docs.omg.dev/docs/mcp";
const APP = "https://app.omg.dev/sandbox";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("IndexNow key file", () => {
  test("committed key is valid and matches the hosted filename", () => {
    expect(isValidIndexNowKey(INDEXNOW_KEY)).toBe(true);
    expect(readCommittedIndexNowKey()).toBe(INDEXNOW_KEY);
    expect(readFileSync(INDEXNOW_KEY_FILE, "utf8").trim()).toBe(INDEXNOW_KEY);
    expect(INDEXNOW_KEY_FILE.endsWith(`${INDEXNOW_KEY}.txt`)).toBe(true);
    expect(keyLocationFor("omg.dev")).toBe(`https://omg.dev/${INDEXNOW_KEY}.txt`);
    expect(keyLocationFor("docs.omg.dev")).toBe(`https://docs.omg.dev/${INDEXNOW_KEY}.txt`);
  });
});

describe("public URL filter", () => {
  test("keeps apex and docs https URLs", () => {
    expect(isPublicIndexNowUrl(APEX)).toBe(true);
    expect(isPublicIndexNowUrl(DOCS)).toBe(true);
    expect(isPublicIndexNowUrl("https://omg.dev/")).toBe(true);
  });

  test("drops app, preview, localhost, and non-https URLs", () => {
    expect(isPublicIndexNowUrl(APP)).toBe(false);
    expect(isPublicIndexNowUrl("https://app.omg.dev/")).toBe(false);
    expect(isPublicIndexNowUrl("http://omg.dev/pricing")).toBe(false);
    expect(isPublicIndexNowUrl("https://localhost:8766/")).toBe(false);
    expect(isPublicIndexNowUrl("https://127.0.0.1/")).toBe(false);
    expect(isPublicIndexNowUrl("https://preview.omg.dev/blog")).toBe(false);
    expect(isPublicIndexNowUrl("https://evil-omg.dev/")).toBe(false);
    expect(isPublicIndexNowUrl("https://omg.dev.evil.example/")).toBe(false);
    expect(isPublicIndexNowUrl("not a url")).toBe(false);
  });

  test("dedups and filters a mixed list", () => {
    expect(filterPublicIndexNowUrls([APEX, APEX, APP, DOCS, "https://localhost/x"])).toEqual([APEX, DOCS]);
    expect(dedupeUrls([APEX, APEX])).toEqual([APEX]);
  });
});

describe("sitemap loc parsing", () => {
  test("reads loc tags from a urlset", () => {
    const xml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://omg.dev/</loc></url>
        <url><loc> ${APP} </loc></url>
        <url><loc>${DOCS}</loc></url>
      </urlset>`;
    expect(locTags(xml)).toEqual(["https://omg.dev/", APP, DOCS]);
  });

  test("collects sitemap URLs plus public page locs, and follows one index", async () => {
    const fetchFn = async (input: string) => {
      if (input === "https://omg.dev/sitemap.xml") {
        return new Response(`<sitemapindex><sitemap><loc>https://omg.dev/blog/sitemap.xml</loc></sitemap></sitemapindex>`);
      }
      if (input === "https://omg.dev/blog/sitemap.xml") {
        return new Response(`<urlset><url><loc>${APEX}</loc></url><url><loc>${APP}</loc></url></urlset>`);
      }
      if (input === "https://docs.omg.dev/sitemap.xml") {
        return new Response(`<urlset><url><loc>${DOCS}</loc></url></urlset>`);
      }
      return new Response("missing", { status: 404 });
    };

    const urls = await collectSitemapUrls([...PUBLIC_SITEMAPS], fetchFn);
    expect(urls).toContain("https://omg.dev/sitemap.xml");
    expect(urls).toContain("https://omg.dev/blog/sitemap.xml");
    expect(urls).toContain(APEX);
    expect(urls).toContain(DOCS);
    expect(urls).not.toContain(APP);
  });
});

describe("IndexNow payloads", () => {
  test("groups by host and attaches keyLocation", () => {
    const payloads = buildIndexNowPayloads([APEX, DOCS, APP, APEX]);
    expect(payloads.map((p) => p.host).sort()).toEqual(["docs.omg.dev", "omg.dev"]);
    const apex = payloads.find((p) => p.host === "omg.dev")!;
    expect(apex.urlList).toEqual([APEX]);
    expect(apex.key).toBe(INDEXNOW_KEY);
    expect(apex.keyLocation).toBe(`https://omg.dev/${INDEXNOW_KEY}.txt`);
    expect(INDEXNOW_HOSTS).toEqual(["omg.dev", "docs.omg.dev"]);
  });

  test("rejects an invalid key", () => {
    expect(() => buildIndexNowPayloads([APEX], "short")).toThrow(/8–128/);
  });
});

describe("submit gates", () => {
  test("defaults to dry-run and requires the env gate for POST", () => {
    expect(parseSubmitArgs([])).toEqual({ submit: false });
    expect(parseSubmitArgs(["--dry-run"])).toEqual({ submit: false });
    expect(parseSubmitArgs(["--submit"])).toEqual({ submit: true });
    expect(() => parseSubmitArgs(["--submit", "--dry-run"])).toThrow(/only one/);
    expect(shouldPostIndexNow({ submit: true, env: {} })).toBe(false);
    expect(shouldPostIndexNow({ submit: true, env: { INDEXNOW_SUBMIT: "1" } })).toBe(true);
    expect(shouldPostIndexNow({ submit: false, env: { INDEXNOW_SUBMIT: "1" } })).toBe(false);
    expect(shouldPostIndexNow({ submit: true, env: { INDEXNOW_SUBMIT: "true" } })).toBe(false);
  });
});

describe("IndexNow HTTP", () => {
  test("200 is success and 202 is a pending-key failure", async () => {
    const payload = buildIndexNowPayloads([APEX])[0]!;
    const ok = await pingIndexNow(payload, async () => jsonResponse(200, ""));
    expect(ok).toEqual({ ok: true, status: 200, error: null });

    const pending = await pingIndexNow(payload, async () => jsonResponse(202, "accepted"));
    expect(pending.ok).toBe(false);
    expect(pending.status).toBe(202);
    expect(pending.error).toContain("key validation is pending");
  });

  test("key location must serve the exact key", async () => {
    const url = keyLocationFor("omg.dev");
    const good = await checkKeyLocationServed(url, INDEXNOW_KEY, async () => new Response(`${INDEXNOW_KEY}\n`));
    expect(good.ok).toBe(true);
    const missing = await checkKeyLocationServed(url, INDEXNOW_KEY, async () => new Response("nope", { status: 404 }));
    expect(missing.ok).toBe(false);
    expect(missing.status).toBe(404);
  });

  test("dry-run never POSTs to IndexNow", async () => {
    const payload = buildIndexNowPayloads([APEX])[0]!;
    const calls: string[] = [];
    const result = await submitIndexNow({
      payloads: [payload],
      post: false,
      fetchFn: async (input) => {
        calls.push(input);
        return jsonResponse(200, "");
      },
    });
    expect(result).toEqual({ ok: true, posted: false });
    expect(calls).toEqual([]);
  });

  test("submit checks the key file before POSTing", async () => {
    const payload = buildIndexNowPayloads([APEX])[0]!;
    const calls: string[] = [];
    const result = await submitIndexNow({
      payloads: [payload],
      post: true,
      fetchFn: async (input) => {
        calls.push(input);
        if (input === payload.keyLocation) return new Response(INDEXNOW_KEY);
        if (input === INDEXNOW_ENDPOINT) return jsonResponse(200, "");
        return new Response("no", { status: 404 });
      },
    });
    expect(result).toEqual({ ok: true, posted: true });
    expect(calls).toEqual([payload.keyLocation, INDEXNOW_ENDPOINT]);
  });
});

describe("GSC sitemap submit", () => {
  test("skips when no access token is configured", async () => {
    const results = await submitSitemapsToGsc(PUBLIC_SITEMAPS, { token: "" });
    expect(results.every((r) => r.skipped && r.ok)).toBe(true);
  });

  test("PUTs each sitemap when a token is present", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const results = await submitSitemapsToGsc(["https://omg.dev/sitemap.xml"], {
      token: "tok",
      site: "sc-domain:omg.dev",
      fetchFn: async (input, init) => {
        calls.push({ url: input, method: init?.method });
        return jsonResponse(200, "");
      },
    });
    expect(results).toEqual([{ sitemapUrl: "https://omg.dev/sitemap.xml", ok: true, status: 200 }]);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toContain("webmasters/v3/sites/");
  });
});

describe("CLI", () => {
  test("--submit without INDEXNOW_SUBMIT=1 exits 2 and does not fetch sitemaps", async () => {
    const calls: string[] = [];
    const code = await main(["--submit"], {
      env: {},
      fetchFn: async (input) => {
        calls.push(input);
        return jsonResponse(200, "");
      },
    });
    expect(code).toBe(2);
    expect(calls).toEqual([]);
  });

  test("dry-run fetches sitemaps and never hits api.indexnow.org", async () => {
    const calls: string[] = [];
    const code = await main(["--dry-run"], {
      env: {},
      fetchFn: async (input) => {
        calls.push(input);
        if (input === "https://omg.dev/sitemap.xml") {
          return new Response(`<urlset><url><loc>${APEX}</loc></url></urlset>`);
        }
        if (input === "https://docs.omg.dev/sitemap.xml") {
          return new Response(`<urlset><url><loc>${DOCS}</loc></url></urlset>`);
        }
        return jsonResponse(500, "should not be called");
      },
    });
    expect(code).toBe(0);
    expect(calls).toEqual([...PUBLIC_SITEMAPS]);
  });
});
