/**
 * Demo mode: the flag, and the fake identity it stands in for.
 *
 * Demo mode makes the whole app render seeded content — see demo-data.ts for
 * the transport that answers it. This file owns whether it is ON and the
 * account it pretends to be signed into.
 *
 * Two ways to turn it on, and they agree through one cached boolean:
 *  - `EXPO_PUBLIC_OMG_DEMO=1` at build/start time. This is the capture path:
 *    start Metro with it set and the app opens straight into the seeded state.
 *  - A Settings toggle, persisted to AsyncStorage, for turning it on inside a
 *    release build (App Store screenshots) without a rebuild.
 *
 * The cached boolean matters because `getHostedTransport` is synchronous and
 * module-scoped: it cannot await AsyncStorage. `loadDemoMode()` runs once at
 * boot, folds the stored override into the cache, and everything reads the
 * cache from then on.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

import type { ComputerBinding } from "./provider";
import type { SignedInUser } from "./auth";

const STORAGE_KEY = "omg:mobile:demo-mode";

/** The one machine demo mode is signed into. Its transport is the seeded one. */
export const DEMO_BINDING_ID = "demo";

export const DEMO_USER: SignedInUser = {
  id: "demo-user",
  email: "you@omg.dev",
  name: "You",
};

export const DEMO_BINDING: ComputerBinding = {
  id: DEMO_BINDING_ID,
  name: "Your Computer",
  online: true,
  lastSeenAt: Date.now(),
  // Pins the folder the home opens on, so the default screen is the full one.
  // Must match a repo cwd in demo-data.ts's bootstrap roster.
  defaultFolder: "/home/user/api-gateway",
};

const envDefault = process.env.EXPO_PUBLIC_OMG_DEMO === "1";

/**
 * The synchronous source of truth. Starts from the env flag so a build started
 * with EXPO_PUBLIC_OMG_DEMO=1 is in demo mode from the very first render, before
 * any AsyncStorage read resolves.
 */
let cache = envDefault;

/** Read the flag synchronously. Cheap enough to call anywhere. */
export function isDemoMode(): boolean {
  return cache;
}

/**
 * Fold the persisted override into the cache. Call once at boot, before the
 * provider's first effect runs. The env flag wins when it is set: a build made
 * for capture should not be silently turned off by a stale stored value.
 */
export async function loadDemoMode(): Promise<boolean> {
  if (envDefault) {
    cache = true;
    return true;
  }
  try {
    cache = (await AsyncStorage.getItem(STORAGE_KEY)) === "1";
  } catch {
    cache = false;
  }
  return cache;
}

/** Persist the override and update the cache. The caller reloads the app. */
export async function setDemoMode(on: boolean): Promise<void> {
  cache = on;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // A failed write only means the toggle will not survive a cold start; the
    // in-memory cache still flips this session.
  }
}

/**
 * Settings row state. Returns the current value and a setter that persists.
 * The env flag pins it on and locks the toggle: a capture build should not
 * offer to turn itself off.
 */
export function useDemoMode(): { value: boolean; locked: boolean; set: (on: boolean) => Promise<void> } {
  const [value, setValue] = useState(cache);
  useEffect(() => {
    setValue(cache);
  }, []);
  const set = useCallback(async (on: boolean) => {
    setValue(on);
    await setDemoMode(on);
  }, []);
  return { value, locked: envDefault, set };
}
