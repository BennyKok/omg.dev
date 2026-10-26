import { useEffect, useState } from "react";
import { api, omgTransportGeneration } from "./omg-client";

/**
 * Which custom models (`custom-<provider>/<model>`, from ~/.omg/models.json)
 * have a server that answers. Asked each time the picker opens, so a server
 * stopped or started since the last look shows its current state. A model
 * missing from the answer, or a failed request, reads as online: the picker
 * never hides a model it could not check.
 */
export function useCustomModelStatus(enabled: boolean): Record<string, { online: boolean }> {
  const generation = omgTransportGeneration();
  const [result, setResult] = useState<{ generation: number; models: Record<string, { online: boolean }> } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    api<{ models?: Record<string, { online: boolean }> }>("/api/custom-models/status", { signal: controller.signal })
      .then(({ models }) => { if (!controller.signal.aborted) setResult({ generation, models: models ?? {} }); })
      .catch(() => {});
    return () => controller.abort();
  }, [enabled, generation]);
  return result?.generation === generation ? result.models : {};
}
