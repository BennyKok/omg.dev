// Payload the Settings "omg.dev updates" row expects from /api/install.
//
// A 200 that is not this payload (SPA shell from a stale worker, an
// intermediary's empty body, HTML from a host proxy) is parsed to `{}` by the
// transport. The row used to store that and then read `info?.install.channel`.
// Optional chaining stops at `info`, so a missing `install` threw and took
// the whole router down. Reject anything that is not the real shape before
// it lands in state, and never read `.channel` without chaining through
// `install` as well.

export type InstallUpdateStatus = {
  channel: "source" | "release";
  state: "up-to-date" | "available" | "blocked";
  currentSha?: string;
  latestSha?: string;
  commitsBehind?: number;
  currentVersion?: string;
  latestVersion?: string;
  latestTag?: string;
  message: string;
  restartSupported: boolean;
  /** Why the update button is disabled, when it is. Server-side diagnosis. */
  restartBlockedReason?: string;
};

export type InstallUpdateInfo = {
  install: { channel: "source" | "release" | "container" | "unknown"; updateCommand: string };
  update: InstallUpdateStatus | null;
  restarting?: boolean;
  bootId: string;
};

export function isInstallUpdateInfo(value: unknown): value is InstallUpdateInfo {
  if (!value || typeof value !== "object") return false;
  const install = (value as { install?: unknown }).install;
  if (!install || typeof install !== "object") return false;
  const rec = install as { channel?: unknown; updateCommand?: unknown };
  return typeof rec.channel === "string" && typeof rec.updateCommand === "string";
}
