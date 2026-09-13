/**
 * Small formatting helpers shared by the list screens.
 */

/**
 * A timestamp the way a person scanning a list reads it: "now", "4m", "3h",
 * "1d", then a date. Compact on purpose — this sits in a row that also
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
  // "1d", not "yesterday": the web's row says it in two characters, and the
  // word was wide enough to push a title into an ellipsis.
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

/** Prefer the API's custom machine name, then the hostname and legacy fallbacks. */
export function bindingLabel(binding: {
  id: string;
  name?: string | null;
  defaultFolder?: string | null;
  computerUrl?: string | null;
}): string {
  if (binding.name?.trim()) return binding.name.trim();
  if (binding.computerUrl) {
    try {
      const host = new URL(binding.computerUrl).hostname.split(".")[0];
      if (host && host !== "localhost" && !/^\d+$/.test(host)) return host;
    } catch {
      /* fall through */
    }
  }
  const folder = binding.defaultFolder?.split("/").filter(Boolean).pop();
  if (folder) return folder;
  return `${binding.id.slice(0, 8)}…`;
}

/** The folder a machine defaults to, for the composer's project caption. */
export function bindingFolderLabel(binding: {
  defaultFolder?: string | null;
}): string | null {
  return binding.defaultFolder?.split("/").filter(Boolean).pop() ?? null;
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

/**
 * A transcript stamp, the way Messages writes one between groups of
 * bubbles: "6:39 PM" today, "Sep 3 6:39 PM" this year, the year added once
 * it is not this one. Read at a glance; never per message.
 */
export function stampTime(ts: number, now = Date.now()): string {
  const date = new Date(ts);
  const today = new Date(now);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return time;
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day} ${time}`;
}

/** Cloud names use the same API field as paired machines. */
export function cloudComputerLabel(cloud?: { name?: string | null } | null): string {
  return cloud?.name?.trim() || "Cloud computer";
}
