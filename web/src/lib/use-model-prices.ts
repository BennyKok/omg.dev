import { useEffect, useState } from "react";
import type { OmgModelPrices } from "../../../packages/protocol/src/model-pricing";
import { api, omgTransportGeneration } from "./omg-client";

export function useModelPrices(enabled: boolean) {
  const generation = omgTransportGeneration();
  const [result, setResult] = useState<{ generation: number; prices: OmgModelPrices["models"] | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    api<OmgModelPrices>("/api/omg/model-prices", { signal: controller.signal })
      .then(({ models }) => { if (!controller.signal.aborted) setResult({ generation, prices: models }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ generation, prices: null }); });
    return () => controller.abort();
  }, [enabled, generation]);
  const current = result?.generation === generation ? result : null;
  return { prices: current?.prices ?? {}, loading: enabled && current === null };
}

export { modelUsageLevel } from "../../../packages/protocol/src/model-pricing";
