/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";

mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
const View = ({ children }: any) => <div>{children}</div>;
const Pressable = ({ children, onPress, accessibilityLabel }: any) => (
  <button aria-label={accessibilityLabel} onClick={onPress}>
    {children}
  </button>
);
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  View,
  ScrollView: View,
  Image: () => null,
  ActivityIndicator: () => null,
  Pressable,
  useWindowDimensions: () => ({ width: 393, height: 852 }),
  StyleSheet: { hairlineWidth: 1, create: (s: any) => s },
}));
const chain: any = new Proxy({}, { get: () => () => chain });
mock.module(import.meta.resolve("react-native-reanimated"), () => ({
  default: { View, createAnimatedComponent: (C: any) => C },
  Easing: { linear: (x: any) => x, bezier: () => (x: any) => x },
  LinearTransition: chain,
  FadeIn: chain,
  ReduceMotion: { Always: "always", Never: "never" },
  useSharedValue: (value: any) => React.useRef({ value }).current,
  useAnimatedStyle: (fn: any) => fn(),
  withTiming: (x: any) => x,
  withRepeat: (x: any) => x,
}));
mock.module(import.meta.resolve("expo-symbols"), () => ({ SymbolView: () => null }));
const local = (file: string, exports: any) =>
  mock.module(resolve(import.meta.dir, `../src/omg/${file}`), () => exports);
local("sheet.tsx", { Sheet: ({ children }: any) => <section>{children}</section> });
local("text.tsx", { Text: ({ children }: any) => <span>{children}</span>, TextInput: () => null });
local("agent-icons.ts", { agentIcon: () => null });
local("model-provider-icons.ts", { modelProviderIcon: () => null });
local("usage.ts", {
  orderWindows: (x: any) => x,
  providerKindForAgent: () => undefined,
  detailsForKind: (_kind: any, accounts: any, merged: any) => (accounts.length ? accounts : merged),
});
local("glass.tsx", { GlassSurface: View, LIQUID_GLASS: false });
local("lucide.tsx", { LucideIcon: () => null });
local("menu.tsx", { DropdownMenu: View });
local("agent-setup-sheet.tsx", { AgentSetupSheet: () => null });
// The starter rail's edge paint pulls in expo-linear-gradient, which
// imports `Platform` from the react-native module stubbed above.
local("edge-fade.tsx", { RailEdgeFades: () => null });
local("skill-suggest.tsx", { SkillSuggest: () => null });
local("session-mention-suggest.tsx", { SessionMentionSuggest: () => null });
local("motion.tsx", {
  PressableScale: Pressable,
  useListItemMotion: () => ({}),
  useReduceMotionEnabled: () => false,
});
local("swipe-row.ts", { useSwipeToCommit: () => ({}) });
local("session-activity.tsx", {
  useSessionActivity: () => ({ present: false }),
  SessionActivityTitle: () => null,
  SessionActivityField: () => null,
});
local("nav-gesture-context.ts", { useBlockNavGesture: () => {} });
const { light, space, type, radius, motion } = await import("../src/omg/palette");
local("theme.ts", { useTheme: () => ({ colors: light, space, type, radius, motion, isDark: false }) });

const { UsageDetails } = await import("../src/components");

const profile = (id: string, label: string, weekly: number, fiveHour: number, plan: string) => ({
  id,
  kind: "claude",
  label,
  accountLabel: label,
  available: true,
  plan,
  windows: [
    { label: "7 day", pct: weekly, resetsAt: Date.now() + 2 * 86400000 },
    { label: "5 hr", pct: fiveHour, resetsAt: Date.now() + 3600000 },
  ],
});

test("the usage drawer names each Claude profile and its own windows", () => {
  const ui = mount();
  try {
    ui.render(
      <UsageDetails
        providers={[
          profile("claude:one", "Claude 1", 42, 18, "Max"),
          profile("claude:two", "Claude 2", 81, 55, "Pro"),
        ]}
      />,
    );
    const text = ui.text();
    expect(text).toContain("Claude 1");
    expect(text).toContain("Claude 2");
    expect(text).toContain("Max");
    expect(text).toContain("Pro");
    expect(text).toContain("42%");
    expect(text).toContain("81%");
    expect(text).toContain("18%");
    expect(text).toContain("55%");
    expect(text).toContain("7 day");
    expect(text).toContain("5 hr");
  } finally {
    ui.cleanup();
  }
});
