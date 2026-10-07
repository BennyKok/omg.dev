// Background auto-update for the packaged desktop app.
//
// Electrobun's Updater reads `release.baseUrl` from the bundled version.json,
// fetches `<channel>-<os>-<arch>-update.json` from it, and compares hashes.
// This module only owns the schedule and the restart prompt. The download,
// verification and swap stay inside Electrobun.

export type UpdaterPort = {
  checkForUpdate(): Promise<{ updateAvailable: boolean; error: string; version: string }>;
  downloadUpdate(): Promise<void>;
  updateInfo(): { updateReady: boolean; error: string; version: string };
  applyUpdate(): Promise<void>;
  localInfo: { channel(): Promise<string>; baseUrl(): Promise<string> };
};

/** Returns true when the user agrees to restart into the new version now. */
export type RestartPrompt = (version: string) => Promise<boolean>;

export type AutoUpdateResult =
  | "disabled"
  | "up-to-date"
  | "declined"
  | "applied"
  | "error";

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function runUpdateCheck(
  updater: UpdaterPort,
  promptRestart: RestartPrompt,
  log: (message: string) => void = console.log,
): Promise<AutoUpdateResult> {
  try {
    const channel = await updater.localInfo.channel();
    const baseUrl = await updater.localInfo.baseUrl();
    if (channel === "dev" || !baseUrl) return "disabled";

    const checked = await updater.checkForUpdate();
    if (checked.error) {
      log(`Update check failed: ${checked.error}`);
      return "error";
    }
    if (!checked.updateAvailable) return "up-to-date";

    await updater.downloadUpdate();
    const downloaded = updater.updateInfo();
    if (downloaded.error || !downloaded.updateReady) {
      log(`Update download failed: ${downloaded.error || "the update is not ready"}`);
      return "error";
    }

    if (!(await promptRestart(downloaded.version || checked.version))) return "declined";
    await updater.applyUpdate();
    return "applied";
  } catch (error) {
    log(`Update failed: ${error instanceof Error ? error.message : String(error)}`);
    return "error";
  }
}

/**
 * Checks once at startup and then on an interval. A declined update is
 * offered again on the next tick. Checks never overlap.
 */
export function startAutoUpdate(
  updater: UpdaterPort,
  promptRestart: RestartPrompt,
  options: { intervalMs?: number; initialDelayMs?: number } = {},
): () => void {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await runUpdateCheck(updater, promptRestart);
      if (result === "disabled" || result === "applied") stop();
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(tick, options.initialDelayMs ?? 15_000);
  const interval = setInterval(tick, options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS);
  function stop() {
    stopped = true;
    clearTimeout(initial);
    clearInterval(interval);
  }
  return stop;
}
