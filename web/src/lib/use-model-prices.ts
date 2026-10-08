import { useEffect, useState } from "react";
import { modelCreditSampleMicros, type OmgModelPrice, type OmgModelPrices } from "../../../packages/protocol/src/model-pricing";
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

// Compare the same workload with the managed default. This is a usage
// guide, not a promise about tokens or the cost of an individual task.
export function modelUsageLevel(price: OmgModelPrice | undefined, baseline: OmgModelPrice | undefined) {
  if (!price || !baseline) return null;
  const baselineCost = modelCreditSampleMicros(baseline);
  if (baselineCost <= 0) return null;
  const relativeCost = modelCreditSampleMicros(price) / baselineCost;
  if (relativeCost <= 2) return { label: "Low", bars: 1 } as const;
  if (relativeCost <= 10) return { label: "Medium", bars: 2 } as const;
  return { label: "High", bars: 3 } as const;
}
