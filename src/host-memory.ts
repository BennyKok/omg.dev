// How much memory the host can still hand out, on Linux and on macOS.
//
// `os.freemem()` is the wrong number on macOS. It counts only wholly untouched
// pages, so a healthy 16 GB Mac reports a few hundred MB free while it holds
// many GB as reclaimable file cache. The settings panel, the memory chart and
// the dashboard then all showed a Mac as nearly full.
//
// Linux: MemAvailable from /proc/meminfo, the kernel's own estimate.
// macOS: `vm_stat`, counted the way Activity Monitor counts "Memory Used"
// (app memory + wired + compressed). Everything else is cache the kernel gives
// back on demand.
// Elsewhere: `freemem()`, marked untrusted.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { freemem, platform, totalmem } from "node:os";

export type HostMemory = {
  totalBytes: number;
  availableBytes: number;
  /**
   * True only for Linux MemAvailable. Admission control that would REFUSE
   * work keys on this, and its rules were written against that reading.
   */
  trusted: boolean;
};

/** Parse `vm_stat` output into available bytes. Null when the shape is unknown. */
export function availableFromVmStat(text: string, totalBytes: number): number | null {
  const pageSize = Number(text.match(/page size of (\d+) bytes/)?.[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0 || totalBytes <= 0) return null;
  const pages = (label: string): number | null => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`^${escaped}:\\s+(\\d+)\\.?$`, "m"));
    return match ? Number(match[1]) : null;
  };
  const anonymous = pages("Anonymous pages");
  const purgeable = pages("Pages purgeable") ?? 0;
  const wired = pages("Pages wired down");
  const compressed = pages("Pages occupied by compressor") ?? 0;
  if (anonymous !== null && wired !== null) {
    // Activity Monitor: App Memory = anonymous - purgeable.
    const usedBytes = (Math.max(0, anonymous - purgeable) + wired + compressed) * pageSize;
    return Math.max(0, Math.min(totalBytes, totalBytes - usedBytes));
  }
  // Older macOS without "Anonymous pages": free + inactive, as psutil does.
  const free = pages("Pages free");
  const inactive = pages("Pages inactive");
  if (free === null || inactive === null) return null;
  return Math.max(0, Math.min(totalBytes, (free + inactive) * pageSize));
}

function readLinuxAvailable(): number | null {
  try {
    const match = readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    return match ? Number(match[1]) * 1024 : null;
  } catch {
    return null;
  }
}

function readDarwinAvailable(totalBytes: number): number | null {
  try {
    const text = execFileSync("/usr/bin/vm_stat", { encoding: "utf8", timeout: 2_000 });
    return availableFromVmStat(text, totalBytes);
  } catch {
    return null;
  }
}

// The settings panel polls every 3 s per open pane and the sampler every 5 s.
// One `vm_stat` per second is plenty for all of them.
const CACHE_MS = 1_000;
let cached: { at: number; value: HostMemory } | null = null;

export function hostMemory(now = Date.now()): HostMemory {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const totalBytes = totalmem();
  let value: HostMemory;
  const linux = readLinuxAvailable();
  if (linux !== null) {
    value = { totalBytes, availableBytes: linux, trusted: true };
  } else {
    const darwin = platform() === "darwin" ? readDarwinAvailable(totalBytes) : null;
    value = { totalBytes, availableBytes: darwin ?? freemem(), trusted: false };
  }
  cached = { at: now, value };
  return value;
}
