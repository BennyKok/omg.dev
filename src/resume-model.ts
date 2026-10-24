import { defaultModelForAgent, isAllowedModelForAgent } from "./agent-catalog.ts";
import type { ResumableBackend } from "./resume-cache.ts";

export function resolveResumeModel(
  backend: ResumableBackend,
  storedModel?: string | null,
  requestedModel?: string | null,
): string {
  // Cursor stores the exact launched variant (for example `kimi-k3-high`),
  // while its picker deliberately collapses that family to `kimi-k3`. The
  // durable row is already pinned to the Cursor backend, so preserve a valid
  // stored slug instead of comparing it with the shorter picker catalog and
  // silently resuming on `auto`.
  if (backend === "cursor" && storedModel && /^[A-Za-z0-9_.:/-]{1,120}$/.test(storedModel)) {
    return storedModel;
  }
  if (storedModel && isAllowedModelForAgent(backend, storedModel)) return storedModel;
  if (requestedModel && isAllowedModelForAgent(backend, requestedModel)) return requestedModel;
  return defaultModelForAgent(backend);
}
