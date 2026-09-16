/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";

mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
let layout: (event: any) => void;
let appListener: (() => void) | undefined;
let reducedMotion = false;
let starts = 0;
let cancels = 0;
const appState = {
  currentState: "active",
  addEventListener: (_: string, listener: () => void) => {
    appListener = listener;
    return { remove: () => { appListener = undefined; } };
  },
};
const View = ({ children, style, onLayout }: any) => {
  if (onLayout) layout = onLayout;
  return <div style={Array.isArray(style) ? Object.assign({}, ...style) : style}>{children}</div>;
};
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  View, AppState: appState, StyleSheet: { absoluteFill: { position: "absolute", inset: 0 } },
}));
mock.module(import.meta.resolve("react-native-reanimated"), () => ({
  default: { View }, Easing: { linear: (value: number) => value },
  useSharedValue: (value: number) => React.useRef({ value }).current,
  useAnimatedStyle: (fn: () => any) => fn(),
  withTiming: (value: number) => value,
  withRepeat: (value: number) => { starts++; return value; },
  cancelAnimation: () => { cancels++; },
}));
mock.module(import.meta.resolve("expo-linear-gradient"), () => ({ LinearGradient: () => null }));
mock.module(resolve(import.meta.dir, "../src/omg/motion.tsx"), () => ({
  useReduceMotionEnabled: () => reducedMotion,
}));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({
  useTheme: () => ({ isDark: true }),
}));
const { SessionActivityField } = await import("../src/omg/session-activity");

test("the grid keeps square spacing at phone, compact, and tablet widths", () => {
  const ui = mount();
  try {
    ui.render(<SessionActivityField identity="one" cornerRadius={12} />);
    for (const [width, height] of [[380, 80], [268, 64], [700, 80]]) {
      ui.flush(() => layout({ nativeEvent: { layout: { width, height } } }));
      const points = [...ui.queryAll("div")].filter((el) => (el as HTMLElement).style.width === "6px") as HTMLElement[];
      const xs = [...new Set(points.map((el) => parseFloat(el.style.left)))].sort((a, b) => a - b);
      const ys = [...new Set(points.map((el) => parseFloat(el.style.top)))].sort((a, b) => a - b);
      expect(xs.length).toBeGreaterThan(20);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(10);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(10);
      expect(xs.at(-1)!).toBeLessThan(width);
      expect(ys.at(-1)!).toBeLessThan(height);
    }
  } finally { ui.cleanup(); }
});

test("Reduce Motion and backgrounding stop the loop; cleanup removes its listener", () => {
  const ui = mount();
  const render = () => ui.render(<SessionActivityField identity="one" cornerRadius={12} />);
  starts = 0; cancels = 0; reducedMotion = true;
  try {
    render();
    expect(starts).toBe(0);
    reducedMotion = false;
    render();
    expect(starts).toBe(1);
    const before = cancels;
    appState.currentState = "background";
    ui.flush(() => appListener?.());
    expect(cancels).toBeGreaterThan(before);
    expect(starts).toBe(1);
    appState.currentState = "active";
    ui.flush(() => appListener?.());
    expect(starts).toBe(2);
    render();
    expect(starts).toBe(2);
    reducedMotion = true;
    render();
    expect(starts).toBe(2);
  } finally { ui.cleanup(); reducedMotion = false; appState.currentState = "active"; }
  expect(appListener).toBeUndefined();
});
