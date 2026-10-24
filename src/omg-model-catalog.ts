import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { PATHS } from "./config.ts";
import { applyOmgCatalog, omgCatalogFromRouter, type OmgCatalogEntry } from "./omg-models.ts";

/**
 * Keeps the omg agent model list in step with the router.
 *
 * The router owns the list (GET /api/cli/llm/v1/models?agent=omg). This module
 * fetches it, applies it to omg-models.ts, and caches the last answer on disk,
 * so a restart or a separate CLI process starts from the last known list
 * instead of the alias-only fallback. A model change on the router reaches a
 * running Computer within one refresh interval, with no lfg release.
 */

// A function, not a constant: config.ts reaches this module through an import
// cycle, so PATHS is not ready while this module loads.
export function omgCatalogPath(): string {
  return join(PATHS.data, "omg-model-catalog.json");
}
export const OMG_CATALOG_REFRESH_MS = 10 * 60_000;

export type OmgCatalogSource = {
  signedIn(): boolean;
  fetch(path: string, init?: RequestInit): Promise<Response>;
};

const ROUTER_PATH = "/api/cli/llm/v1/models?agent=omg";

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return out.length ? out : undefined;
}

/**
 * Router rows -> catalog entries. Each row carries an `omgAgent` object.
 * Returns null when the answer has no usable row, so a bad answer never
 * empties the picker.
 */
export function parseOmgCatalogRows(rows: unknown): OmgCatalogEntry[] | null {
  if (!Array.isArray(rows)) return null;
  const out: OmgCatalogEntry[] = [];
  for (const row of rows) {
    const agent = row && typeof row === "object" ? (row as { omgAgent?: unknown }).omgAgent : null;
    if (!agent || typeof agent !== "object") continue;
    const a = agent as Record<string, unknown>;
    if (typeof a.id !== "string" || !a.id) continue;
    out.push({
      id: a.id,
      label: typeof a.label === "string" && a.label ? a.label : a.id,
      ...(a.deprecated === true ? { deprecated: true } : {}),
      ...(a.imageInput === true ? { imageInput: true } : {}),
      ...(stringList(a.thinkingLevels) ? { thinkingLevels: stringList(a.thinkingLevels) } : {}),
      ...(typeof a.defaultThinkingLevel === "string" && a.defaultThinkingLevel ? { defaultThinkingLevel: a.defaultThinkingLevel } : {}),
    });
  }
  return out.some((entry) => !entry.deprecated) ? out : null;
}

/** Apply the cached router answer, if there is one. Returns true when applied. */
export function loadOmgCatalogCache(path = omgCatalogPath()): boolean {
  try {
    const cached = JSON.parse(readFileSync(path, "utf8")) as { models?: unknown };
    const entries = Array.isArray(cached.models) ? cached.models as OmgCatalogEntry[] : null;
    if (!entries?.some((entry) => entry && typeof entry.id === "string" && !entry.deprecated)) return false;
    applyOmgCatalog(entries);
    return true;
  } catch {
    return false;
  }
}

function writeCache(path: string, entries: OmgCatalogEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify({ fetchedAt: Date.now(), models: entries }, null, 2)}\n`);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * Fetch the list from the router and apply it. Keeps the current list on any
 * failure. The event carries status, row count and duration for evlog.
 */
export async function refreshOmgModelCatalog(
  source: OmgCatalogSource,
  onEvent: (fields: Record<string, unknown>) => void = () => {},
  path = omgCatalogPath(),
): Promise<boolean> {
  const started = performance.now();
  const fields: Record<string, unknown> = {};
  try {
    if (!source.signedIn()) {
      fields.result = "signed_out";
      return false;
    }
    const response = await source.fetch(ROUTER_PATH, { signal: AbortSignal.timeout(10_000) });
    fields.upstreamStatus = response.status;
    if (!response.ok) {
      fields.result = "router_unavailable";
      return false;
    }
    const entries = parseOmgCatalogRows(await response.json());
    if (!entries) {
      fields.result = "invalid_catalog";
      return false;
    }
    applyOmgCatalog(entries);
    writeCache(path, entries);
    fields.result = "applied";
    fields.modelCount = entries.length;
    fields.deprecatedCount = entries.filter((entry) => entry.deprecated).length;
    return true;
  } catch (error) {
    fields.result = "request_failed";
    fields.error = error instanceof Error ? error.name : "unknown";
    return false;
  } finally {
    onEvent({ ...fields, durationMs: Math.round(performance.now() - started) });
  }
}

/** Refresh now, then every OMG_CATALOG_REFRESH_MS. Returns a stop function. */
export function startOmgModelCatalogRefresh(
  source: OmgCatalogSource,
  onEvent: (fields: Record<string, unknown>) => void = () => {},
): () => void {
  ensureOmgCatalogLoaded();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await refreshOmgModelCatalog(source, onEvent);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), OMG_CATALOG_REFRESH_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

let cacheChecked = false;

/**
 * Apply the disk cache once, before the first read in this process, unless a
 * router answer already arrived. Server-side readers call this; a module load
 * cannot, because of the import cycle above.
 */
export function ensureOmgCatalogLoaded(): void {
  if (cacheChecked) return;
  cacheChecked = true;
  if (!omgCatalogFromRouter()) loadOmgCatalogCache();
}
