/**
 * OVER-THE-AIR UPDATES, APPLIED ON THE WAY OUT.
 *
 * expo-updates' default is to launch on the cached bundle, download a newer
 * one in the background, and run it on the NEXT cold launch — so every
 * update was one restart behind, and a change published an hour ago was
 * still invisible on the phone that had been opened since. This hook checks
 * at launch and again whenever the app returns to the foreground after a
 * pause, and downloads what it finds.
 *
 * It restarts into a downloaded update when the app goes to the BACKGROUND,
 * not the moment the download lands. A reload while the screen is live races
 * React Native's own teardown: TestFlight 1.0.14 (84) crashed 2.4 s after
 * launch in `Scheduler::uiManagerDidFinishTransaction` (a queued render
 * running against the scheduler the reload had just destroyed), and the icon
 * font's re-registration during a reload crashed text drawing in
 * `RCTGetFontWeight`. With nothing on screen there is nothing to render, and
 * the next look at the app is already the new bundle.
 *
 * Inert in a dev client (Updates.isEnabled is false there) and never throws:
 * an update check that fails is the old bundle, which is what you had.
 */
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as Updates from "expo-updates";

/** Do not re-check on every quick app switch; a pause this long is a real return. */
const FOREGROUND_AFTER_MS = 20_000;

export function useOtaUpdates() {
  const backgroundedAt = useRef<number | null>(null);
  const checking = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;

    const check = async () => {
      if (checking.current || pending.current) return;
      checking.current = true;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return;
        const fetched = await Updates.fetchUpdateAsync();
        if (!fetched.isNew) return;
        pending.current = true;
        // Downloaded while the app was already on its way out: apply now.
        if (AppState.currentState === "background") void apply();
      } catch {
        // Offline, or the update server is unreachable: the current bundle stands.
      } finally {
        checking.current = false;
      }
    };

    const apply = async () => {
      try {
        await Updates.reloadAsync();
      } catch {
        // The reload was refused; the update still runs on the next cold launch.
      }
    };

    void check();
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "background") {
        backgroundedAt.current = backgroundedAt.current ?? Date.now();
        if (pending.current) void apply();
        return;
      }
      if (state === "inactive") {
        backgroundedAt.current = backgroundedAt.current ?? Date.now();
        return;
      }
      if (state === "active") {
        const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
        backgroundedAt.current = null;
        if (away >= FOREGROUND_AFTER_MS) void check();
      }
    });
    return () => sub.remove();
  }, []);
}
