import { useEffect, useSyncExternalStore } from "react";
import type { OmgModelPrices } from "../../../packages/protocol/src/model-pricing";
import { api, omgTransportGeneration } from "./omg-client";

// Hosted model prices, shared by every picker on the page.
//
// Each picker used to fetch on open, so the list drew first as one flat run
// and then jumped into its credit-usage groups when the prices came back. One
// cache per Computer connection, filled before the picker opens (the composer
// prefetches it), lets the list draw grouped in one pass. A price list
// changes rarely; an entry older than PRICES_TTL_MS is read again in the
// background and the cached one stays on screen meanwhile.

type Prices = OmgModelPrices["models"];
type Entry = { generation: number; prices: Prices | null; at: number };

const PRICES_TTL_MS = 10 * 60_000;

let entry: Entry | null = null;
let inflight: { generation: number } | null = null;
const listeners = new Set<() => void>();

function publish(next: Entry) {
  entry = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => entry;

/** Start loading the prices for the current Computer, unless a fresh copy or a read is already there. */
export function prefetchModelPrices(): void {
  const generation = omgTransportGeneration();
  const current = entry?.generation === generation ? entry : null;
  if (current?.prices && Date.now() - current.at < PRICES_TTL_MS) return;
  if (inflight?.generation === generation) return;
  const read = { generation };
  inflight = read;
  api<OmgModelPrices>("/api/omg/model-prices")
    .then(
      ({ models }) => ({ generation, prices: models, at: Date.now() }),
      // A failure is shown (usage unavailable) and read again on the next open.
      () => ({ generation, prices: null, at: 0 }),
    )
    .then((next) => {
      if (inflight === read) inflight = null;
      // A swap to another Computer while this was in flight makes it stale.
      if (generation !== omgTransportGeneration()) return;
      publish(next);
    });
}

/** Warm the cache from a surface that can open a picker, without subscribing to it. */
export function usePrefetchModelPrices(models: readonly string[]): void {
  const generation = omgTransportGeneration();
  const hasManagedModels = models.some((model) => model.startsWith("omg/"));
  useEffect(() => {
    if (hasManagedModels) prefetchModelPrices();
  }, [hasManagedModels, generation]);
}

export function useModelPrices(enabled: boolean) {
  const generation = omgTransportGeneration();
  const cached = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (enabled) prefetchModelPrices();
  }, [enabled, generation]);
  const current = cached?.generation === generation ? cached : null;
  return { prices: current?.prices ?? {}, loading: enabled && current === null };
}

export { modelUsageLevel } from "../../../packages/protocol/src/model-pricing";
