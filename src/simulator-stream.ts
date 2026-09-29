import type { SimulatorStreamProvider } from "../packages/protocol/src/project-preview.ts";

/**
 * Level 2 of the Expo preview card: an iOS Simulator on a remote Mac,
 * streamed into the card. Off by default. `LFG_PREVIEW_SIMULATOR=1` turns the
 * "Simulator" level on in every card of this Computer.
 *
 * The streaming service is built elsewhere. Until it plugs in here, the flag
 * shows the level with an honest "not available" state, so the card layout
 * can be tested without a Mac. Replace `unavailableProvider` with the real
 * provider; nothing in the card or the preview service changes.
 */
export function simulatorStreamProvider(env: Record<string, string | undefined> = process.env): SimulatorStreamProvider | null {
  if (env.LFG_PREVIEW_SIMULATOR !== "1") return null;
  return unavailableProvider;
}

const NOT_YET = "The simulator preview is not available on this Computer yet.";

const unavailableProvider: SimulatorStreamProvider = {
  status: async () => ({ state: "unavailable", message: NOT_YET }),
  start: async () => ({ state: "unavailable", message: NOT_YET }),
  stop: async () => {},
};
