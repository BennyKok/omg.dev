/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from "../../web/src/test-support/render";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { useEffect, useRef, type ReactNode } from "../../web/node_modules/react";
import { resolve } from "node:path";

import * as React from "../../web/node_modules/react";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);

const completions: ((done: boolean) => void)[] = [];
let nativePan: any;
let modalTouch: (() => void) | undefined;
let touchStart: (() => boolean) | undefined;
let touchEnd: (() => void) | undefined;
let handleTouch: (() => void) | undefined;
let reduced = false;
const scrolls = new Map<string, any>();
const View = ({ children, onLayout, style, accessibilityValue, onStartShouldSetResponderCapture, onTouchStart, onTouchEnd }: any) => {
  if (onStartShouldSetResponderCapture) { touchStart = onStartShouldSetResponderCapture; touchEnd = onTouchEnd; }
  if (accessibilityValue) handleTouch = onTouchStart;
  useEffect(() => { onLayout?.({ nativeEvent: { layout: { height: style?.flex === 1 ? 844 : 600 } } }); }, []);
  return <div data-stage={accessibilityValue?.text}>{children}</div>;
};
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  View, ScrollView: (props: any) => { scrolls.set(props.testID ?? "outer", props); return <View {...props} />; }, KeyboardAvoidingView: View,
  Modal: ({ children, onShow, visible }: { children: ReactNode; onShow: () => void; visible: boolean }) => {
    useEffect(() => { if (visible) onShow(); }, [visible]);
    return visible ? <section role="dialog">{children}</section> : null;
  },
  Pressable: ({ children, onPress, accessibilityLabel }: any) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  Keyboard: { dismiss() {} }, Platform: { OS: "ios" }, StyleSheet: { absoluteFill: {} },
  useWindowDimensions: () => ({ height: 844, width: 390 }),
}));
mock.module(import.meta.resolve("react-native-gesture-handler"), () => ({
  GestureHandlerRootView: (props: any) => { modalTouch = props.onTouchStart; return <View {...props} />; },
  NativeViewGestureHandler: View,
  PanGestureHandler: (props: any) => { nativePan = props; return <View>{props.children}</View>; },
  State: { ACTIVE: 4, END: 5, CANCELLED: 3, FAILED: 1 },
}));
const activate = (dy: number) => nativePan.onHandlerStateChange({ nativeEvent: { state: 4, translationX: 0, translationY: dy, velocityY: 0 } });
const release = (dy: number, vy: number) => nativePan.onHandlerStateChange({ nativeEvent: { state: 5, translationX: 0, translationY: dy, velocityY: vy * 1000 } });
const transition = { duration: () => transition, easing: () => transition };
mock.module(import.meta.resolve("react-native-reanimated"), () => ({
  default: { View }, Easing: { bezier: () => (x: number) => x },
  FadeInLeft: transition, FadeInRight: transition, FadeOut: transition,
  cancelAnimation() {}, runOnJS: (fn: Function) => fn,
  useSharedValue: (value: number) => useRef({ value }).current,
  useAnimatedStyle: (fn: Function) => fn(),
  withTiming: (value: number, _options: unknown, done?: (done: boolean) => void) => { if (done) completions.push(done); return value; },
}));
mock.module(import.meta.resolve("react-native-safe-area-context"), () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) }));
mock.module(resolve(import.meta.dir, "../src/omg/motion.tsx"), () => ({ useReduceMotionEnabled: () => reduced }));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: {}, isDark: false }) }));
const { Sheet } = await import("../src/omg/sheet");
const { SheetScrollView, useBlockSheetDrag } = await import("../src/omg/sheet-scroll");
let ui: Mounted;
beforeEach(() => { completions.length = 0; scrolls.clear(); reduced = false; ui = mount(); });
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
  ui.flush(() => { activate(9); release(2, 0); });
  expect(completions).toHaveLength(0);
  ui.flush(() => { activate(9); release(300, 1); });
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


test("body swipes expand, collapse, and then dismiss the drawer", () => {
  ui.render(<Sheet visible onClose={() => {}}>Report</Sheet>);
  const swipe = (dy: number, vy: number) => ui.flush(() => {
    touchStart?.();
    activate(dy);
    nativePan.onGestureEvent({ nativeEvent: { translationY: dy } });
    release(dy, vy);
  });
  swipe(-100, -0.5);
  expect(ui.query('[data-stage="expanded"]')).not.toBeNull();
  expect(completions).toHaveLength(0);
  swipe(70, 0.5);
  expect(ui.query('[data-stage="compact"]')).not.toBeNull();
  expect(completions).toHaveLength(0);
  swipe(40, 0.8);
  expect(completions).toHaveLength(1);
  ui.flush(() => completions.shift()!(true));
  expect(ui.query('[role="dialog"]')).toBeNull();
});


test("nested and outer scroll offsets prevent accidental drawer drags", () => {
  ui.render(<Sheet visible onClose={() => {}}><SheetScrollView testID="inner">Rows</SheetScrollView></Sheet>);
  const offset = (id: string, y: number) => scrolls.get(id).onScroll({ nativeEvent: { contentOffset: { y } } });
  const start = () => {
    touchStart?.();
    scrolls.get("inner").onTouchStart({});
    scrolls.get("outer").onTouchStart({});
  };
  offset("inner", 80);
  start();
  ui.flush(() => activate(60));
  expect(scrolls.get("inner").scrollEnabled).toBe(true);
  offset("inner", 0);
  offset("outer", 50);
  start();
  ui.flush(() => activate(60));
  expect(scrolls.get("inner").scrollEnabled).toBe(true);
  offset("outer", 0);
  start();
  ui.flush(() => activate(-60));
  expect(scrolls.get("inner").scrollEnabled).toBe(false);
  ui.flush(() => release(-60, -0.5));
  expect(scrolls.get("inner").scrollEnabled).toBe(true);
});


test("the handle ignores a scrolled body's offset", () => {
  ui.render(<Sheet visible onClose={() => {}}>Rows</Sheet>);
  scrolls.get("outer").onScroll({ nativeEvent: { contentOffset: { y: 120 } } });
  scrolls.get("outer").onTouchStart({});
  ui.flush(() => { handleTouch?.(); activate(-80); release(-80, -0.5); });
  expect(ui.query('[data-stage="expanded"]')).not.toBeNull();
});

test("child reordering disables the native sheet recognizer until touch end", () => {
  let block: () => void;
  function Reorder() { block = useBlockSheetDrag(); return null; }
  ui.render(<Sheet visible onClose={() => {}}><Reorder /></Sheet>);
  ui.flush(() => block());
  expect(nativePan.enabled).toBe(false);
  ui.flush(() => touchEnd?.());
  expect(nativePan.enabled).toBe(true);
});


test("native scroll drift is restored when a body swipe belongs to the drawer", () => {
  ui.render(<Sheet visible onClose={() => {}}>Rows</Sheet>);
  scrolls.get("outer").onTouchStart({});
  scrolls.get("outer").onScroll({ nativeEvent: { contentOffset: { y: 6.67 } } });
  ui.flush(() => { activate(-6.67); release(-60, -0.5); });
  expect(ui.query('[data-stage="expanded"]')).not.toBeNull();
  scrolls.get("outer").onTouchStart({});
  ui.flush(() => activate(6.67));
  expect(scrolls.get("outer").scrollEnabled).toBe(false);
});

test("dialog touches exclude navigation without stealing the sheet gesture", async () => {
  const { NavGestureContext } = await import("../src/omg/nav-gesture-context");
  let blocked = 0;
  ui.render(<NavGestureContext.Provider value={() => blocked++}><Sheet visible onClose={() => {}}>Content</Sheet></NavGestureContext.Provider>);
  ui.flush(() => modalTouch?.());
  expect(blocked).toBe(1);
  expect(nativePan.enabled).toBe(true);
});
