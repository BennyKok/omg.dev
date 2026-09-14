/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from "../../web/src/test-support/render";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { useEffect, useRef, type ReactNode } from "../../web/node_modules/react";
import { resolve } from "node:path";

import * as React from "../../web/node_modules/react";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);

const completions: ((done: boolean) => void)[] = [];
let pans: Record<string, (...args: any[]) => void>;
let reduced = false;
const View = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  View, ScrollView: View, KeyboardAvoidingView: View,
  Modal: ({ children, onShow, visible }: { children: ReactNode; onShow: () => void; visible: boolean }) => {
    useEffect(() => { if (visible) onShow(); }, [visible]);
    return visible ? <section role="dialog">{children}</section> : null;
  },
  Pressable: ({ children, onPress, accessibilityLabel }: any) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  Keyboard: { dismiss() {} }, Platform: { OS: "ios" }, StyleSheet: { absoluteFill: {} },
  useWindowDimensions: () => ({ height: 844, width: 390 }),
  PanResponder: { create: (handlers: typeof pans) => { pans = handlers; return { panHandlers: {} }; } },
}));
const transition = { duration: () => transition, easing: () => transition };
mock.module(import.meta.resolve("react-native-reanimated"), () => ({
  default: { View }, Easing: { bezier: () => (x: number) => x },
  FadeInLeft: transition, FadeInRight: transition, FadeOut: transition,
  runOnJS: (fn: Function) => fn,
  useSharedValue: (value: number) => useRef({ value }).current,
  useAnimatedStyle: (fn: Function) => fn(),
  withTiming: (value: number, _options: unknown, done?: (done: boolean) => void) => { if (done) completions.push(done); return value; },
}));
mock.module(import.meta.resolve("react-native-safe-area-context"), () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) }));
mock.module(resolve(import.meta.dir, "../src/omg/motion.tsx"), () => ({ useReduceMotionEnabled: () => reduced }));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: {}, isDark: false }) }));
const { Sheet } = await import("../src/omg/sheet");
let ui: Mounted;
beforeEach(() => { completions.length = 0; reduced = false; ui = mount(); });
afterEach(() => ui.cleanup());

test("closing retains the tray until its exit completes and notifies once", () => {
  let closed = 0;
  ui.render(<Sheet visible onClose={() => closed++}>Report</Sheet>);
  ui.flush(() => (ui.query('button[aria-label="Close"]') as HTMLElement).click());
  expect(ui.text()).toContain("Report");
  expect(closed).toBe(0);
  ui.flush(() => completions.shift()!(true));
  expect(ui.query('[role="dialog"]')).toBeNull();
  expect(closed).toBe(1);
});

test("page navigation keeps the native tray mounted and replaces its contents", () => {
  ui.render(<Sheet visible pageKey="list" onClose={() => {}}>List</Sheet>);
  const dialog = ui.query('[role="dialog"]');
  ui.render(<Sheet visible pageKey="create" onClose={() => {}}>Create</Sheet>);
  expect(ui.query('[role="dialog"]')).toBe(dialog);
  expect(ui.text()).toBe("Create");
});

test("short drags settle; long drags dismiss through the same lifecycle", () => {
  ui.render(<Sheet visible onClose={() => {}}>Report</Sheet>);
  ui.flush(() => pans.onPanResponderRelease(null, { dy: 2, vy: 0 }));
  expect(completions).toHaveLength(0);
  ui.flush(() => pans.onPanResponderRelease(null, { dy: 300, vy: 1 }));
  expect(completions).toHaveLength(1);
  ui.flush(() => completions.shift()!(true));
  expect(ui.query('[role="dialog"]')).toBeNull();
});

test("a tray can reopen after external dismissal without notifying the owner again", () => {
  let closed = 0;
  const render = (visible: boolean) => ui.render(<Sheet visible={visible} onClose={() => closed++}>Report</Sheet>);
  render(true);
  render(false);
  expect(ui.query('[role="dialog"]')).not.toBeNull();
  ui.flush(() => completions.shift()!(true));
  expect(closed).toBe(0);
  render(true);
  expect(ui.text()).toBe("Report");
});
