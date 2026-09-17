import type { PresenceRenewal } from "./presence";

/** Existing Computers require active presence; first provisioning creates its owner row. */
export async function wakeAfterPresence<T>(
  presence: { renew: () => Promise<PresenceRenewal> },
  wake: () => Promise<T>,
  isCurrent: () => boolean,
): Promise<T | undefined> {
  const accepted = await presence.renew();
  if (!isCurrent()) return undefined;
  if (accepted === "unprovisioned") {
    const created = await wake();
    if (!isCurrent()) return undefined;
    const renewed = await presence.renew();
    if (!isCurrent()) return undefined;
    if (renewed !== true) throw new Error("Could not connect to your Computer. Try again.");
    return created;
  }
  if (!accepted) throw new Error("Could not connect to your Computer. Try again.");
  return wake();
}
