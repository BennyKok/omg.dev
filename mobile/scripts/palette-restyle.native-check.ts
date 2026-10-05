/**
 * The 2026-10 web restyle tokens. Each one is either derived from a synced
 * token (so check-theme-drift.ts covers its source) or quotes a fixed web
 * value. This pins both kinds, in both appearances.
 */
import { expect, test } from "bun:test";

import { control, dark, fieldEdgeStops, light, radius } from "../src/omg/palette";

test("the field edge follows the foreground at the web's color-mix stops", () => {
  expect(light.fieldEdge).toEqual([
    "rgba(0, 0, 0, 0.24)",
    "rgba(0, 0, 0, 0.08)",
    "rgba(0, 0, 0, 0.04)",
    "rgba(0, 0, 0, 0.14)",
  ]);
  expect(dark.fieldEdgeFocus).toEqual([
    "rgba(242, 242, 237, 0.4)",
    "rgba(242, 242, 237, 0.16)",
    "rgba(242, 242, 237, 0.1)",
    "rgba(242, 242, 237, 0.26)",
  ]);
  expect(fieldEdgeStops).toEqual([0, 0.44, 0.72, 1]);
});

test("tile and meter fills are the foreground at 5 and 10 percent", () => {
  expect(light.tileFill).toBe("rgba(0, 0, 0, 0.05)");
  expect(dark.meterTrack).toBe("rgba(242, 242, 237, 0.1)");
});

test("low-meter text is legible amber in each appearance", () => {
  expect(light.meterLowText).toBe("#bb4d00");
  expect(dark.meterLowText).toBe("#ffd230");
  expect(light.meterLow).toBe(dark.meterLow);
});

test("starter tints use the 500 shade in light and the 400 shade in dark", () => {
  expect(light.starter).toEqual({ website: "#00a6f4", app: "#00bc7d", api: "#fe9a00", image: "#f6339a" });
  expect(dark.starter).toEqual({ website: "#00bcff", app: "#00d492", api: "#ffb900", image: "#fb64b6" });
});

test("control sizes and the tile radius match the web classes", () => {
  expect(control).toEqual({ pill: 36, row: 36, tile: 32, meter: 6, headerFade: 24 });
  expect(radius.tile).toBe(9);
});
