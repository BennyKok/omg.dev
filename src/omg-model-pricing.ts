import type { OmgModelPrice, OmgModelPrices } from "../packages/protocol/src/model-pricing.ts";
import { OMG_MODELS } from "./omg-models.ts";

export type ModelPricingSource = {
  signedIn(): boolean;
  fetch(path: string, init?: RequestInit): Promise<Response>;
};

/** Prices come from the billing router. No client-side price table. */
export async function handleOmgModelPrices(
  req: Request,
  cloud: ModelPricingSource,
  onEvent: (fields: Record<string, unknown>) => void = () => {},
): Promise<Response> {
  const started = performance.now();
  const fields: Record<string, unknown> = {};
  try {
    if (req.method !== "GET") {
      fields.status = 405;
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    if (!cloud.signedIn()) {
      fields.status = 503;
      return Response.json({ error: "Credit estimates unavailable" }, { status: 503 });
    }
    const upstream = await cloud.fetch("/api/cli/llm/v1/models", {
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]),
    });
    fields.upstreamStatus = upstream.status;
    if (!upstream.ok) throw new Error("router_unavailable");
    const rows: unknown = await upstream.json();
    if (!Array.isArray(rows)) throw new Error("invalid_catalog");
    const models: OmgModelPrices["models"] = {};
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const id = typeof row.id === "string" ? `omg/${row.id}` : "";
      if (!OMG_MODELS.includes(id)) continue;
      if (!validRate(row.inputPricePerMillion) || !validRate(row.outputPricePerMillion)) continue;
      const price: OmgModelPrice = {
        inputPricePerMillion: row.inputPricePerMillion,
        outputPricePerMillion: row.outputPricePerMillion,
      };
      if (validRate(row.cacheReadPricePerMillion)) price.cacheReadPricePerMillion = row.cacheReadPricePerMillion;
      models[id] = price;
    }
    fields.modelCount = Object.keys(models).length;
    fields.status = 200;
    return Response.json({ models } satisfies OmgModelPrices, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    fields.status = 502;
    fields.error = error instanceof Error && ["invalid_catalog", "router_unavailable"].includes(error.message)
      ? error.message : "request_failed";
    return Response.json({ error: "Credit estimates unavailable" }, { status: 502 });
  } finally {
    onEvent({ ...fields, durationMs: Math.round(performance.now() - started) });
  }
}

function validRate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
