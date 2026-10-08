/** Router prices in microdollars per million tokens. */
export interface OmgModelPrice {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadPricePerMillion?: number;
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
