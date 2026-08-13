import { createHash } from "node:crypto";
import { getGlobalSettingsSync } from "../settings.ts";

export type WakeHooksPayload = {
  hooks: Array<{ id: string; schedule: string; enabled: boolean }>;
  tz: string;
  bootId?: string;
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let loggedFailure = false;
let serverBootId: string | undefined;

function opaqueAgentId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

export function setWakeHooksBootId(bootId: string | undefined): void {
  serverBootId = bootId;
}

// Managed environments provide a sandbox-scoped URL. Authentication is ambient,
// so no provider credentials or account details belong in this request.
export async function pushWakeHooksNow(): Promise<void> {
  const url = process.env.OMG_SCHEDULE_URL;
  if (!url) return;

  try {
    const { listAutoAgents } = await import("./store.ts");
    const agents = await listAutoAgents();
    const payload: WakeHooksPayload = {
      hooks: agents.map(({ id, schedule, enabled }) => ({
        id: opaqueAgentId(id),
        schedule,
        enabled,
      })),
      tz: getGlobalSettingsSync().timeZone,
      ...(serverBootId ? { bootId: serverBootId } : {}),
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.status !== 204) {
      throw new Error(`unexpected status ${response.status}`);
    }
  } catch (error) {
    if (!loggedFailure) {
      loggedFailure = true;
      console.warn(`[wake-hooks] push failed: ${error}`);
    }
  }
}

export function scheduleWakeHooksPush(delayMs = 2_000): void {
  if (!process.env.OMG_SCHEDULE_URL) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void pushWakeHooksNow();
  }, delayMs);
}

export function cancelScheduledWakeHooksPush(): void {
  if (!debounceTimer) return;
  clearTimeout(debounceTimer);
  debounceTimer = null;
}
