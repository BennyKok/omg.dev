/** @jsxImportSource ../../web/node_modules/react */
/**
 * Benny, 2026-09-24: no splash inside the onboarding flow.
 *
 * Step 04 waits for the Computer to take the first task. It used to wait on
 * the splash (about 10 to 40 s for a new account). With the prompt the person
 * just wrote, it must wait on the working screen instead, and an answer given
 * while waiting must hold until the task starts.
 */
import { mount } from "../../web/src/test-support/render";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";

mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
const View = ({ children }: any) => <div>{children}</div>;
const Pressable = ({ children, onPress, accessibilityLabel }: any) => (
  <button aria-label={accessibilityLabel} onClick={onPress}>
    {typeof children === "function" ? children({ pressed: false }) : children}
  </button>
);
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  View,
  ScrollView: View,
  Image: () => null,
  ActivityIndicator: () => <i>busy</i>,
  Pressable,
  useWindowDimensions: () => ({ width: 393, height: 852 }),
  useColorScheme: () => "dark",
  StyleSheet: { hairlineWidth: 1, create: (s: any) => s },
}));
mock.module(import.meta.resolve("react-native-safe-area-context"), () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
mock.module(import.meta.resolve("expo-haptics"), () => ({ selectionAsync: async () => {} }));
mock.module(resolve(import.meta.dir, "../src/components.tsx"), () => ({ Icon: () => null }));
const local = (file: string, exports: any) =>
  mock.module(resolve(import.meta.dir, `../src/omg/${file}`), () => exports);
local("text.tsx", { Text: ({ children }: any) => <span>{children}</span> });
local("agent-icons.ts", { agentIcon: () => null });
local("village-scene.ts", { backgroundsFor: () => ({ large: { dark: 1, light: 1 }, small: { dark: 1, light: 1 } }) });
local("onboarding-continue.tsx", { ContinueScreen: () => <p>continue-screen</p> });
local("onboarding-transcript.tsx", { OnboardingTranscript: () => null });
local("onboarding-plan.tsx", { PlanScreen: () => <p>plan-screen</p> });
let prefetches = 0;
local("purchase-flow.ts", { prefetchPurchaseCatalog: () => { prefetches += 1; } });

// The Computer answers "not ready" until the test says otherwise.
let launch: any = { kind: "not-ready" };
local("onboarding-launch.ts", { launchOnboardingTask: async () => launch });

const { OnboardingAfterSignIn } = await import("../src/omg/onboarding-after");

let ui: ReturnType<typeof mount>;
beforeEach(() => {
  launch = { kind: "not-ready" };
  ui = mount();
});
afterEach(() => ui.cleanup());

const render = (pendingTitle: string | null) =>
  ui.render(
    <OnboardingAfterSignIn
      client={null}
      ready={false}
      agent="claude"
      runningCount={1}
      onNotify={() => {}}
      onOpenSession={() => {}}
      onDone={() => {}}
      pendingTitle={pendingTitle}
      splash={<p>SPLASH</p>}
    />,
  );

test("while the Computer starts, the person sees their own task, not the splash", async () => {
  render("Explain this error.");
  await ui.flushAsync();
  expect(ui.text()).not.toContain("SPLASH");
  expect(ui.text()).toContain("Explain this error.");
  expect(ui.text()).toContain("Notify me");
});

test("an answer given while waiting says so, and moves on once the task starts", async () => {
  render("Explain this error.");
  await ui.flushAsync();
  const notNow = ui.queryAll("button").find((b) => b.textContent === "Not now")!;
  await ui.flushAsync(async () => notNow.click());
  expect(ui.text()).toContain("Starting your computer...");
  expect(ui.text()).not.toContain("SPLASH");

  launch = { kind: "started", sessionId: "s1", prompt: "Explain this error.", interest: null };
  // The not-ready poll comes back after a second.
  await ui.flushAsync(async () => { await new Promise((r) => setTimeout(r, 1100)); });
  await ui.flushAsync();
  expect(ui.text()).toContain("continue-screen");
});

test("the pricing page's plans start loading as soon as step 04 opens", async () => {
  const before = prefetches;
  render("Explain this error.");
  await ui.flushAsync();
  expect(prefetches).toBe(before + 1);
});

test("a prompt from an earlier launch, with no title in hand, still uses the splash", async () => {
  render(null);
  await ui.flushAsync();
  expect(ui.text()).toContain("SPLASH");
});
