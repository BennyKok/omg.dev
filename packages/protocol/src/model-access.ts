/** The router's plan denial can arrive wrapped in an agent's error text. */
export function isModelPlanDenied(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; reason?: unknown; message?: unknown };
    if (value.code === "model_not_in_plan" || value.reason === "model_not_in_plan") return true;
    return typeof value.message === "string" && isModelPlanDenied(value.message);
  }
  // Agent adapters discard HTTP error metadata. Match only the router's
  // specific model denial, never a generic 402 or an unrelated provider error.
  return typeof error === "string" && (
    /\bmodel_not_in_plan\b/.test(error) ||
    /\bUpgrade your plan to use this model\./i.test(error)
  );
}
