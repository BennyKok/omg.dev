import { describe, expect, test } from "bun:test";
import { shouldReloadRuntime } from "./runtime-availability";

// A socket that goes live decides whether the bootstrap runs again. A wrong
// answer either loads the whole Computer twice on every open, or keeps the
// data of a runtime that has restarted.
describe("shouldReloadRuntime", () => {
  const loaded = { inFlight: false, loaded: true, failed: false, previousBootId: "boot-1", currentBootId: "boot-1" };

  test("a first open whose bootstrap is still running does not load twice", () => {
    expect(shouldReloadRuntime({ ...loaded, inFlight: true, loaded: false, previousBootId: null, currentBootId: "boot-1" })).toBe(false);
  });

  test("a connection with nothing loaded and nothing running loads", () => {
    expect(shouldReloadRuntime({ ...loaded, loaded: false, previousBootId: null })).toBe(true);
  });

  test("a failed bootstrap is retried when the socket comes back", () => {
    expect(shouldReloadRuntime({ ...loaded, failed: true })).toBe(true);
  });

  test("a restarted runtime reloads; the same runtime does not", () => {
    expect(shouldReloadRuntime({ ...loaded, currentBootId: "boot-2" })).toBe(true);
    expect(shouldReloadRuntime(loaded)).toBe(false);
  });

  test("an older runtime without a bootId keeps its loaded bootstrap", () => {
    expect(shouldReloadRuntime({ ...loaded, previousBootId: null, currentBootId: null })).toBe(false);
  });
});
