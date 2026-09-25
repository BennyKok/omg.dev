/**
 * The account's first-run record on the server, shared with the web app.
 *
 * Web and iOS both show the first-task cards to a new account. Each used to
 * keep its own "done" flag (the web on the Computer, iOS on the phone), so a
 * person who started on one and opened the other within the hour got the cards
 * again and started a second first task. The control plane now keeps one
 * record per account (vibes control-plane/lib/first-run.ts):
 *
 *   POST /api/authState/getFirstRun      -> { needed, doneAt }
 *   POST /api/authState/markFirstRunDone -> { needed, doneAt }
 *
 * Both fail soft. An older server without the routes, or no network, returns
 * null and the app keeps its own createdAt rule and local flag.
 */
import { getAuthToken } from "./auth";
import { CONTROLPLANE_ORIGIN } from "./config";

import type { FirstRunRecord } from "./onboarding-gate";

export type { FirstRunRecord } from "./onboarding-gate";

async function call(name: "getFirstRun" | "markFirstRunDone"): Promise<FirstRunRecord | null> {
  try {
    const token = await getAuthToken();
    if (!token) return null;
    const response = await fetch(`${CONTROLPLANE_ORIGIN}/api/authState/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<FirstRunRecord> | null;
    if (!data || typeof data.needed !== "boolean") return null;
    return { needed: data.needed, doneAt: typeof data.doneAt === "number" ? data.doneAt : null };
  } catch {
    return null;
  }
}

export function getFirstRunRecord(): Promise<FirstRunRecord | null> {
  return call("getFirstRun");
}

/** Record the first run as done for the whole account. Idempotent. */
export function markFirstRunRecordDone(): Promise<FirstRunRecord | null> {
  return call("markFirstRunDone");
}
