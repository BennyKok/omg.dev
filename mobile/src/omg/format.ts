/**
 * Small formatting helpers shared by the list screens.
 */

/**
 * A timestamp the way a person scanning a list reads it: "now", "4m", "3h",
 * "yesterday", then a date. Compact on purpose — this sits in a row that also
 * carries a title, and a full date string pushes the title into an ellipsis.
 */
export function relativeTime(ts?: number | null): string {
  if (!ts) return "";
  const delta = Date.now() - ts;
  if (delta < 0) return "now";
  const seconds = Math.floor(delta / 1000);
  if (seconds < 45) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Bytes-ish machine spec line, e.g. "4 vCPU · 8 GB · 64 GB". */
export function machineSpec(machine?: {
  vcpus?: number;
  memoryMib?: number;
  diskGib?: number;
}): string | null {
  if (!machine) return null;
  const parts: string[] = [];
  if (machine.vcpus) parts.push(`${machine.vcpus} vCPU`);
  if (machine.memoryMib) parts.push(`${Math.round(machine.memoryMib / 1024)} GB RAM`);
  if (machine.diskGib) parts.push(`${machine.diskGib} GB disk`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * A machine's human name. Paired boxes report a folder rather than a hostname,
 * and its basename is the most recognisable thing we have — "vibes" beats
 * "62494ca7-db41-4e88…" for someone picking between two machines.
 */
export function bindingLabel(binding: {
  id: string;
  defaultFolder?: string | null;
  computerUrl?: string | null;
}): string {
  const folder = binding.defaultFolder?.split("/").filter(Boolean).pop();
  if (folder) return folder;
  if (binding.computerUrl) {
    try {
      return new URL(binding.computerUrl).hostname.split(".")[0];
    } catch {
      /* fall through */
    }
  }
  return `${binding.id.slice(0, 8)}…`;
}

/** Turn a readiness/cloud status code into something a person can act on. */
export function cloudStatusLabel(status?: string, blockedReason?: string | null): string {
  switch (status) {
    case "upgrade_required":
      return blockedReason === "plan_downgraded"
        ? "Your plan no longer covers this computer"
        : "Included computer time is used up";
    case "provisioning":
      return "Setting up…";
    case "paused":
      return "Paused";
    case "recycled":
      return "Removed";
    case "ready":
    case "running":
      return "Ready";
    default:
      return status ? status.replace(/_/g, " ") : "Unknown";
  }
}
