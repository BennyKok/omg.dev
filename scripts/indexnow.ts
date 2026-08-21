/**
 * IndexNow helpers for the public omg.dev hosts.
 *
 * This runtime repo does not deploy https://omg.dev or https://docs.omg.dev.
 * Those hosts are the hosted product (Caddy apex + Cloudflare/Fumadocs).
 * The key file in scripts/indexnow/ is the source of truth: copy it to each
 * host's static root so GET https://<host>/<key>.txt returns the key as
 * text/plain. Search engines fetch that file to prove ownership.
 *
 * Google does not speak IndexNow. Do not treat a successful ping as a
 * replacement for Search Console sitemap submission.
 *
 * The retired Bing sitemap ping (https://www.bing.com/ping?sitemap=) returns
 * HTTP 410. The only supported notify path is POST https://api.indexnow.org/indexnow.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** 32 hex chars (IndexNow allows 8–128 hex / [A-Za-z0-9-]). */
export const INDEXNOW_KEY = "3ec7fbeb8241def221cf92823220d4dc";

export const INDEXNOW_HOSTS = ["omg.dev", "docs.omg.dev"] as const;
export type IndexNowHost = (typeof INDEXNOW_HOSTS)[number];

export const PUBLIC_SITEMAPS = [
  "https://omg.dev/sitemap.xml",
  "https://docs.omg.dev/sitemap.xml",
] as const;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const INDEXNOW_KEY_FILE = join(SCRIPT_DIR, "indexnow", `${INDEXNOW_KEY}.txt`);

const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;

export type IndexNowPayload = {
  host: IndexNowHost;
  key: string;
  keyLocation: string;
  urlList: string[];
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function isValidIndexNowKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function keyLocationFor(host: IndexNowHost, key: string = INDEXNOW_KEY): string {
  return `https://${host}/${key}.txt`;
}

export function readCommittedIndexNowKey(path: string = INDEXNOW_KEY_FILE): string {
  return readFileSync(path, "utf8").trim();
}

/**
 * Public marketing/docs URLs only. Drops localhost, previews, and the
 * authenticated app host (app.omg.dev), even when a sitemap lists them.
 */
export function isPublicIndexNowUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return (INDEXNOW_HOSTS as readonly string[]).includes(url.hostname);
}

export function locTags(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const loc = match[1]?.trim();
    if (loc) out.push(loc);
  }
  return out;
}

export function dedupeUrls(urls: readonly string[]): string[] {
  return [...new Set(urls)];
}

export function filterPublicIndexNowUrls(urls: readonly string[]): string[] {
  return dedupeUrls(urls.filter(isPublicIndexNowUrl));
}

export function groupUrlsByHost(urls: readonly string[]): Map<IndexNowHost, string[]> {
  const grouped = new Map<IndexNowHost, string[]>();
  for (const host of INDEXNOW_HOSTS) grouped.set(host, []);
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (!(INDEXNOW_HOSTS as readonly string[]).includes(url.hostname)) continue;
    grouped.get(url.hostname as IndexNowHost)!.push(raw);
  }
  return grouped;
}

export function buildIndexNowPayloads(urls: readonly string[], key: string = INDEXNOW_KEY): IndexNowPayload[] {
  if (!isValidIndexNowKey(key)) {
    throw new Error(`IndexNow key must be 8–128 characters of [A-Za-z0-9-], got ${JSON.stringify(key)}`);
  }
  const payloads: IndexNowPayload[] = [];
  for (const [host, urlList] of groupUrlsByHost(filterPublicIndexNowUrls(urls))) {
    if (urlList.length === 0) continue;
    payloads.push({
      host,
      key,
      keyLocation: keyLocationFor(host, key),
      urlList,
    });
  }
  return payloads;
}

export async function collectSitemapUrls(
  sitemapUrls: readonly string[] = PUBLIC_SITEMAPS,
  fetchFn: FetchLike = fetch,
  remainingIndexDepth = 2,
): Promise<string[]> {
  const collected: string[] = [...sitemapUrls];
  for (const sitemapUrl of sitemapUrls) {
    const res = await fetchFn(sitemapUrl);
    if (!res.ok) {
      throw new Error(`GET ${sitemapUrl} → ${res.status}`);
    }
    const xml = await res.text();
    const locs = locTags(xml);
    const childSitemaps = remainingIndexDepth > 0
      ? locs.filter((loc) => loc.endsWith(".xml") && loc !== sitemapUrl)
      : [];
    const pages = locs.filter((loc) => !childSitemaps.includes(loc));
    collected.push(...pages);
    if (childSitemaps.length > 0) {
      collected.push(
        ...await collectSitemapUrls(childSitemaps, fetchFn, remainingIndexDepth - 1),
      );
    }
  }
  return filterPublicIndexNowUrls(collected);
}

export type KeyLocationCheck = {
  ok: boolean;
  status: number | null;
  error: string | null;
};

export async function checkKeyLocationServed(
  keyLocation: string,
  expectedKey: string,
  fetchFn: FetchLike = fetch,
): Promise<KeyLocationCheck> {
  try {
    const res = await fetchFn(keyLocation);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `GET ${keyLocation} → ${res.status} (expected 200)`,
      };
    }
    const body = (await res.text()).trim();
    if (body !== expectedKey) {
      return {
        ok: false,
        status: res.status,
        error: `GET ${keyLocation} returned 200 but the body does not match the key`,
      };
    }
    return { ok: true, status: res.status, error: null };
  } catch (error) {
    return { ok: false, status: null, error: (error as Error).message };
  }
}

export type IndexNowPingResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
};

/**
 * 202 means IndexNow accepted the URL list but has not verified the key
 * file yet. Treat that as a failure here so a missing key file cannot
 * look like a successful production ping.
 */
export async function pingIndexNow(
  payload: IndexNowPayload,
  fetchFn: FetchLike = fetch,
): Promise<IndexNowPingResult> {
  try {
    const res = await fetchFn(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    if (res.status === 202) {
      return {
        ok: false,
        status: 202,
        error: `202 — IndexNow has the URL list but key validation is pending. Confirm GET ${payload.keyLocation} returns 200 with the key.`,
      };
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      return { ok: false, status: res.status, error: body };
    }
    return { ok: true, status: res.status, error: null };
  } catch (error) {
    return { ok: false, status: null, error: (error as Error).message };
  }
}

export function parseSubmitArgs(argv: readonly string[]): { submit: boolean } {
  const submit = argv.includes("--submit");
  const dryRun = argv.includes("--dry-run");
  if (submit && dryRun) {
    throw new Error("Pass only one of --submit or --dry-run");
  }
  return { submit };
}

/**
 * Production POST requires both --submit and INDEXNOW_SUBMIT=1.
 * CI and local runs stay dry-run unless that gate is set on purpose.
 */
export function shouldPostIndexNow(opts: { submit: boolean; env?: NodeJS.ProcessEnv }): boolean {
  const env = opts.env ?? process.env;
  return opts.submit && env.INDEXNOW_SUBMIT === "1";
}
