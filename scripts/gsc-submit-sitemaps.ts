#!/usr/bin/env bun
/**
 * Search-engine sitemap notify for the public omg.dev hosts.
 *
 * Live https://omg.dev/robots.txt already names this path as the Search
 * Console feed. This runtime repo had no such script and does not deploy
 * the apex or docs hosts. The script is the single local owner for:
 *
 *   1. Optional Google Search Console sitemap PUT, when GSC_ACCESS_TOKEN
 *      is set. Google does not speak IndexNow; this path stays.
 *   2. IndexNow POST to https://api.indexnow.org/indexnow for omg.dev
 *      and docs.omg.dev public URLs collected from those sitemaps.
 *
 * Default is dry-run (print payloads, no IndexNow POST). A real ping
 * needs both `--submit` and INDEXNOW_SUBMIT=1. GitHub Actions never sets
 * that variable on pull_request or push. Use workflow_dispatch.
 *
 * Usage:
 *   bun run scripts/gsc-submit-sitemaps.ts
 *   bun run scripts/gsc-submit-sitemaps.ts --dry-run
 *   INDEXNOW_SUBMIT=1 bun run scripts/gsc-submit-sitemaps.ts --submit
 */

import {
  INDEXNOW_KEY,
  PUBLIC_SITEMAPS,
  buildIndexNowPayloads,
  checkKeyLocationServed,
  collectSitemapUrls,
  parseSubmitArgs,
  pingIndexNow,
  readCommittedIndexNowKey,
  shouldPostIndexNow,
  type FetchLike,
  type IndexNowPayload,
} from "./indexnow.ts";

const LOG = "[gsc-submit-sitemaps]";
const GSC_SITE_DEFAULT = "sc-domain:omg.dev";

export type GscSubmitResult = {
  sitemapUrl: string;
  ok: boolean;
  status: number;
  skipped?: boolean;
  error?: string;
};

type GscDeps = {
  token?: string;
  site?: string;
  fetchFn?: FetchLike;
};

export async function submitSitemapsToGsc(
  sitemapUrls: readonly string[] = PUBLIC_SITEMAPS,
  deps: GscDeps = {},
): Promise<GscSubmitResult[]> {
  const token = deps.token ?? process.env.GSC_ACCESS_TOKEN;
  const site = deps.site ?? process.env.GSC_SITE ?? GSC_SITE_DEFAULT;
  const fetchFn = deps.fetchFn ?? fetch;
  if (!token) {
    return sitemapUrls.map((sitemapUrl) => ({
      sitemapUrl,
      ok: true,
      status: 0,
      skipped: true,
      error: "GSC_ACCESS_TOKEN is unset; Search Console submit skipped",
    }));
  }

  const results: GscSubmitResult[] = [];
  for (const sitemapUrl of sitemapUrls) {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
    try {
      const res = await fetchFn(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        results.push({ sitemapUrl, ok: true, status: res.status });
        continue;
      }
      results.push({
        sitemapUrl,
        ok: false,
        status: res.status,
        error: (await res.text()).slice(0, 200),
      });
    } catch (error) {
      results.push({
        sitemapUrl,
        ok: false,
        status: 0,
        error: (error as Error).message,
      });
    }
  }
  return results;
}

export async function submitIndexNow(opts: {
  payloads: IndexNowPayload[];
  post: boolean;
  fetchFn?: FetchLike;
}): Promise<{ ok: boolean; posted: boolean }> {
  const fetchFn = opts.fetchFn ?? fetch;
  if (!opts.post) {
    for (const payload of opts.payloads) {
      console.log(`${LOG} dry-run ${payload.host} (${payload.urlList.length} URLs)`);
      console.log(JSON.stringify(payload, null, 2));
    }
    return { ok: true, posted: false };
  }

  let ok = true;
  for (const payload of opts.payloads) {
    const keyCheck = await checkKeyLocationServed(payload.keyLocation, payload.key, fetchFn);
    if (!keyCheck.ok) {
      console.error(`${LOG} key file not served at ${payload.keyLocation}: ${keyCheck.error}`);
      ok = false;
      continue;
    }
    console.log(`${LOG} POST ${payload.host} (${payload.urlList.length} URLs)`);
    const result = await pingIndexNow(payload, fetchFn);
    if (!result.ok) {
      console.error(`${LOG} IndexNow ${payload.host} failed status=${result.status} error=${result.error}`);
      ok = false;
      continue;
    }
    console.log(`${LOG} IndexNow ${payload.host} ok status=${result.status}`);
  }
  return { ok, posted: true };
}

export async function main(
  argv: string[] = process.argv.slice(2),
  deps: { fetchFn?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const { submit } = parseSubmitArgs(argv);
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  const post = shouldPostIndexNow({ submit, env });

  if (submit && !post) {
    console.error(`${LOG} --submit requires INDEXNOW_SUBMIT=1. Refusing to POST.`);
    return 2;
  }

  const committedKey = readCommittedIndexNowKey();
  if (committedKey !== INDEXNOW_KEY) {
    console.error(`${LOG} committed key file does not match INDEXNOW_KEY`);
    return 1;
  }

  const urls = await collectSitemapUrls(PUBLIC_SITEMAPS, fetchFn);
  const payloads = buildIndexNowPayloads(urls, INDEXNOW_KEY);
  if (payloads.length === 0) {
    console.error(`${LOG} no public omg.dev / docs.omg.dev URLs to notify`);
    return 1;
  }

  const gsc = await submitSitemapsToGsc(PUBLIC_SITEMAPS, {
    fetchFn,
    token: env.GSC_ACCESS_TOKEN ?? "",
    site: env.GSC_SITE ?? GSC_SITE_DEFAULT,
  });
  for (const result of gsc) {
    if (result.skipped) {
      console.log(`${LOG} GSC skip ${result.sitemapUrl}: ${result.error}`);
    } else if (result.ok) {
      console.log(`${LOG} GSC ok ${result.sitemapUrl} status=${result.status}`);
    } else {
      console.error(`${LOG} GSC fail ${result.sitemapUrl} status=${result.status}: ${result.error}`);
    }
  }

  const indexNow = await submitIndexNow({ payloads, post, fetchFn });
  const gscFailed = gsc.some((result) => !result.ok);
  return indexNow.ok && !gscFailed ? 0 : 1;
}

if (import.meta.main) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 2;
  });
}
