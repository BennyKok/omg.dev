/**
 * OVER-THE-AIR UPDATES, APPLIED WHEN THEY LAND.
 *
 * expo-updates' default is to launch on the cached bundle, download a newer
 * one in the background, and run it on the NEXT cold launch — so every
 * update was one restart behind, and a change published an hour ago was
 * still invisible on the phone that had been opened since. This hook checks
 * at launch and again whenever the app returns to the foreground after a
 * pause; when an update is fetched it restarts into it right away. Coming
 * back to the app is a fresh look anyway, and a restart there is the moment
 * nobody is mid-sentence.
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

  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;

    const check = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return;
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew) await Updates.reloadAsync();
      } catch {
        // Offline, or the update server is unreachable: the current bundle stands.
      } finally {
        checking.current = false;
      }
    };

    void check();
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "background" || state === "inactive") {
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
