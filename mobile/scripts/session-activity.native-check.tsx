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
let finishTiming: ((finished: boolean) => void) | undefined;
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
  default: { View, createAnimatedComponent: (component: any) => component },
  runOnJS: (fn: any) => fn, interpolateColor: () => "#ffffff", Easing: { linear: (value: number) => value },
  useSharedValue: (value: number) => React.useRef({ value }).current,
  useAnimatedStyle: (fn: () => any) => fn(),
  withTiming: (value: number, _: any, done?: (finished: boolean) => void) => {
    if (done) finishTiming = done;
    return value;
  },
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
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({ Text: View }));
const { SessionActivityField, useSessionActivity, activityWave } = await import("../src/omg/session-activity");

function Field({ active = true, textBounds }: { active?: boolean; textBounds?: any }) {
  const activity = useSessionActivity(active);
  return <SessionActivityField activity={activity} textBounds={textBounds} cornerRadius={12} />;
}

test("the grid keeps square spacing at phone, compact, and tablet widths", () => {
  const ui = mount();
  try {
    ui.render(<Field />);
    for (const [width, height] of [[380, 80], [268, 64], [700, 80]]) {
      ui.flush(() => layout({ nativeEvent: { layout: { width, height } } }));
      const points = [...ui.queryAll("div")].filter((el) => (el as HTMLElement).style.width === "7px") as HTMLElement[];
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
  const render = () => ui.render(<Field />);
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

test("the wave lights columns in order and clears both loop edges", () => {
  expect(activityWave(0, 0)).toBe(0);
  expect(activityWave(1, 1)).toBe(0);
  for (const x of [0.1, 0.4, 0.8]) {
    const phase = (x + 0.3) / 1.6;
    expect(activityWave(phase, x)).toBeCloseTo(1);
    expect(activityWave(phase, x + 0.3)).toBeCloseTo(0);
  }
});

test("exit retains the field until fading completes; a restart cancels removal", () => {
  const ui = mount();
  try {
    ui.render(<Field />);
    expect(ui.queryAll("div").length).toBeGreaterThan(0);
    ui.render(<Field active={false} />);
    expect(ui.queryAll("div").length).toBeGreaterThan(0);
    const staleExit = finishTiming;
    ui.render(<Field />);
    ui.flush(() => staleExit?.(true));
    expect(ui.queryAll("div").length).toBeGreaterThan(0);
    ui.render(<Field active={false} />);
    ui.flush(() => finishTiming?.(true));
    expect(ui.queryAll("div").length).toBe(0);
  } finally { ui.cleanup(); }
});

test("measured text dims its dots without dimming the bottom margin", () => {
  const ui = mount();
  const opacityAt = (x: number, y: number) => {
    const dot = [...ui.queryAll("div")].find((el) => {
      const s = (el as HTMLElement).style;
      return s.width === "7px" && parseFloat(s.left) === x - 3.5 && parseFloat(s.top) === y - 3.5;
    }) as HTMLElement;
    return parseFloat(dot.style.opacity);
  };
  try {
    ui.render(<Field />);
    ui.flush(() => layout({ nativeEvent: { layout: { width: 380, height: 80 } } }));
    const underText = opacityAt(155, 35);
    const bottom = opacityAt(155, 75);
    ui.render(<Field textBounds={{ x: 70, y: 20, width: 200, height: 34 }} />);
    expect(opacityAt(155, 35)).toBeCloseTo(underText * 0.12);
    expect(opacityAt(155, 75)).toBeCloseTo(bottom);
  } finally { ui.cleanup(); }
});
