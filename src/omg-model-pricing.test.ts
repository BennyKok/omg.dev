import { expect, test } from "bun:test";
import { handleOmgModelPrices } from "./omg-model-pricing.ts";
import { modelCreditSampleMicros, type OmgModelPrices } from "../packages/protocol/src/model-pricing.ts";

const request = () => new Request("http://127.0.0.1/api/omg/model-prices");

test("credit estimates use router prices and omit unlisted or invalid rates", async () => {
  const calls: string[] = [];
  const events: Record<string, unknown>[] = [];
  const response = await handleOmgModelPrices(request(), {
    signedIn: () => true,
    fetch: async (path) => {
      calls.push(path);
      return Response.json([
        { id: "anthropic/claude-haiku-5.5", inputPricePerMillion: 100_000, outputPricePerMillion: 500_000, cacheReadPricePerMillion: 10_000 },
        { id: "anthropic/claude-opus-5.5", inputPricePerMillion: 4_000_000, outputPricePerMillion: 20_000_000, available: false, minPlan: "pro" },
        { id: "not-offered", inputPricePerMillion: 1, outputPricePerMillion: 1 },
        { id: "apex", inputPricePerMillion: -1, outputPricePerMillion: 1 },
        { id: "openai/gpt-6-luna", inputPricePerMillion: "100000", outputPricePerMillion: 1 },
      ]);
    },
  }, (event) => events.push(event));
  expect(response.status).toBe(200);
  expect(calls).toEqual(["/api/cli/llm/v1/models"]);
  const { models } = await response.json() as OmgModelPrices;
  expect(Object.keys(models)).toEqual(["omg/anthropic/claude-haiku-5.5", "omg/anthropic/claude-opus-5.5"]);
  expect(modelCreditSampleMicros(models["omg/anthropic/claude-haiku-5.5"])).toBe(1500);
  expect(modelCreditSampleMicros(models["omg/anthropic/claude-opus-5.5"])).toBe(60_000);
  expect(models["omg/anthropic/claude-haiku-5.5"].cacheReadPricePerMillion).toBe(10_000);
  expect(models["omg/anthropic/claude-opus-5.5"].available).toBe(false);
  expect(models["omg/anthropic/claude-opus-5.5"].minPlan).toBe("pro");
  expect(models["omg/anthropic/claude-haiku-5.5"].available).toBeUndefined();
  expect(events[0]).toMatchObject({ status: 200, upstreamStatus: 200, modelCount: 2 });
});

test("a signed-out machine makes no pricing request", async () => {
  let called = false;
  const response = await handleOmgModelPrices(request(), {
    signedIn: () => false,
    fetch: async () => { called = true; throw new Error("must not fetch"); },
  });
  expect(response.status).toBe(503);
  expect(called).toBe(false);
});

test("router failures and invalid catalogs do not become free prices", async () => {
  for (const fetch of [
    async () => new Response("private upstream details", { status: 401 }),
    async () => Response.json({ data: [] }),
    async () => { throw new Error("private upstream details"); },
  ]) {
    const response = await handleOmgModelPrices(request(), { signedIn: () => true, fetch });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Credit estimates unavailable" });
  }
});
