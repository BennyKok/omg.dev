import { useEffect, useMemo, useState } from "react";
import type { OmgModelPrices } from "../../../packages/protocol/src/model-pricing";
import { useOmg } from "./provider";

/** Prices follow the selected Computer and wait for it to wake. */
export function useModelPrices(enabled: boolean) {
  const { client, bindingId, readiness, modelsVersion } = useOmg();
  const ready = readiness?.status === "ready";
  const scope = useMemo(() => ({}), [client, bindingId, ready, modelsVersion]);
  const [result, setResult] = useState<{ scope: object; prices: OmgModelPrices["models"] } | null>(null);
  useEffect(() => {
    if (!enabled || !client || !ready) return;
    let cancelled = false;
    client.transport.request<OmgModelPrices>("/api/omg/model-prices")
      .then(({ models }) => { if (!cancelled) setResult({ scope, prices: models }); })
      .catch(() => { if (!cancelled) setResult({ scope, prices: {} }); });
    return () => { cancelled = true; };
  }, [enabled, client, ready, scope]);
  const current = enabled && ready && result?.scope === scope ? result : null;
  return { prices: current?.prices ?? {}, loading: enabled && current === null };
}
