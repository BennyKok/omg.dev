/**
 * expo-router's hook for incoming system URLs. Not a route: expo-router
 * excludes `+native-intent` from the route tree.
 *
 * The rule lives in `src/omg/system-path.ts` so it can be tested without a
 * navigator, and so both the cold-start and the running-app paths go through
 * the same one.
 */
import { systemPathTarget } from "../src/omg/system-path";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  return systemPathTarget(path);
}
