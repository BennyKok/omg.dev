import { expect, test } from "bun:test";
import { isModelPlanDenied } from "./model-access";

test("identifies model plan denials after provider error wrapping", () => {
  for (const error of [
    { code: "model_not_in_plan" },
    { reason: "model_not_in_plan" },
    new Error("402: Upgrade your plan to use this model."),
    'APIError: {"message":"Upgrade your plan to use this model.\\n"}',
    "billing: model_not_in_plan",
  ]) expect(isModelPlanDenied(error)).toBe(true);
});

test("other failures never become a model upgrade request", () => {
  for (const error of [null, undefined, {}, 402, new Error("provider unavailable"),
    "Out of credits — upgrade your plan to keep building.",
    { status: 402, message: "Payment required by provider" },
    "Please reconnect your Claude account.",
  ]) expect(isModelPlanDenied(error)).toBe(false);
});
