/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
const View = ({ children, accessibilityLabel }: any) => <div aria-label={accessibilityLabel}>{children}</div>;
let listener = () => {};
const appState = { currentState: "active", addEventListener: (_: string, fn: () => void) => { listener = fn; return { remove() { listener = () => {}; } }; } };
mock.module(import.meta.resolve("react-native"), () => ({ View, AppState: appState }));
mock.module(resolve(import.meta.dir, "../src/components.tsx"), () => ({ Row: View, Separator: () => null }));
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({ Text: View }));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: {} }) }));
let starts = 0, stops = 0;
let report: (value: any) => void;
mock.module(resolve(import.meta.dir, "../src/omg/connection-ping.ts"), () => ({
  startConnectionPing: (_: unknown, callback: typeof report) => { starts++; report = callback; return () => { stops++; }; },
}));
const { ConnectionPingRow } = await import("../src/omg/connection-ping-row");
const transport = { openLiveSocket: async () => ({} as any) };

test("renders live location and milliseconds, then clears stale values in background", () => {
  const ui = mount(); starts = stops = 0; appState.currentState = "active";
  try {
    ui.render(<ConnectionPingRow transport={transport} active />);
    expect(ui.text()).toContain("Measuring…");
    ui.flush(() => report({ route: "Relay · Canada", status: "connected", ms: 42 }));
    expect(ui.text()).toContain("Relay · Canada"); expect(ui.text()).toContain("42 ms");
    ui.flush(() => { appState.currentState = "background"; listener(); });
    expect(stops).toBe(1); expect(ui.text()).not.toContain("42 ms");
    ui.flush(() => { appState.currentState = "active"; listener(); });
    expect(starts).toBe(2);
    ui.render(<ConnectionPingRow transport={transport} active={false} />);
    expect(stops).toBe(2);
  } finally { ui.cleanup(); }
});

test("does not probe without a selected computer or in demo mode", () => {
  const ui = mount(); starts = 0;
  try {
    ui.render(<ConnectionPingRow transport={null} active />);
    expect(ui.text()).toContain("No computer selected");
    ui.render(<ConnectionPingRow transport={transport} active demo />);
    expect(ui.text()).toContain("Demo"); expect(starts).toBe(0);
  } finally { ui.cleanup(); }
});
