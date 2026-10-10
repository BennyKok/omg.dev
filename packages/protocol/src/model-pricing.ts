/** Router prices in microdollars per million tokens. */
export interface OmgModelPrice {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadPricePerMillion?: number;
  /** Account permissions from the billing router. Missing on older servers. */
  available?: boolean;
  minPlan?: string;
}

export interface OmgModelPrices {
  models: Record<string, OmgModelPrice>;
}

/** The same uncached sample for every model, independent of actual turns. */
export const MODEL_CREDIT_SAMPLE = { inputTokens: 10_000, outputTokens: 1_000 } as const;

export function modelCreditSampleMicros(price: OmgModelPrice): number {
  return (price.inputPricePerMillion * MODEL_CREDIT_SAMPLE.inputTokens +
    price.outputPricePerMillion * MODEL_CREDIT_SAMPLE.outputTokens) / 1_000_000;
}

/** Compare an equal workload against the managed default. */
export function modelUsageLevel(price: OmgModelPrice | undefined, baseline: OmgModelPrice | undefined) {
  if (!price || !baseline) return null;
  const baselineCost = modelCreditSampleMicros(baseline);
  if (baselineCost <= 0) return null;
  const relativeCost = modelCreditSampleMicros(price) / baselineCost;
  if (relativeCost <= 2) return { label: "Low", bars: 1 } as const;
  if (relativeCost <= 10) return { label: "Medium", bars: 2 } as const;
  return { label: "High", bars: 3 } as const;
}

export const MODEL_USAGE_GROUPS = [
  { level: 1, label: "Standard usage" },
  { level: 2, label: "Higher usage" },
  { level: 3, label: "Highest usage" },
  { level: 0, label: "Usage unavailable" },
] as const;
