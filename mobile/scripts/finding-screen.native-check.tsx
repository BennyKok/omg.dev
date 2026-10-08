/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from "../../web/src/test-support/render";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
const View = ({ children }: any) => <div>{children}</div>;
const Button = ({ children, onPress, disabled, accessibilityLabel }: any) => <button onClick={onPress} disabled={disabled} aria-label={accessibilityLabel}>{children}</button>;
mock.module("react-native", () => ({ View, ScrollView: View, ActivityIndicator: () => <span>Loading</span>, StyleSheet: { hairlineWidth: 1 } }));
mock.module("expo-haptics", () => ({ notificationAsync: async () => {}, NotificationFeedbackType: { Success: "success" } }));
mock.module("expo-clipboard", () => ({ setStringAsync: async () => {} }));
mock.module("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
const navigation: string[] = [];
const router = { dismissTo: (path: string) => navigation.push(`dismissTo:${path}`), replace: (path: string) => navigation.push(`replace:${path}`), back: () => navigation.push("back"), canGoBack: () => true };
mock.module("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => router, useLocalSearchParams: () => ({ agentId: "watch", findingId: "f1" }) }));
mock.module(resolve(import.meta.dir, "../src/omg/motion.tsx"), () => ({ PressableScale: Button }));
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({ Text: View }));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: {}, type: {}, space: {}, radius: {} }) }));
mock.module(resolve(import.meta.dir, "../src/components.tsx"), () => ({ Icon: () => null, EmptyState: ({ title, detail }: any) => <div>{title}{detail}</div>, PrimaryButton: ({ label, onPress, loading, disabled }: any) => <button onClick={onPress} disabled={disabled || loading}>{label}</button> }));
mock.module(resolve(import.meta.dir, "../src/omg/auto-agent-card.tsx"), () => ({ SeverityBadge: ({ severity }: any) => <span>{severity}</span> }));
const toasts: string[] = [];
mock.module(resolve(import.meta.dir, "../src/omg/toast.tsx"), () => ({ useToast: () => ({ show: (text: string) => toasts.push(text) }) }));
let launch: () => Promise<any>;
let launchBody: any;
const client = { transport: { request: (_: string, init: RequestInit) => { launchBody = JSON.parse(String(init.body)); return launch(); } } };
mock.module(resolve(import.meta.dir, "../src/omg/session-options.ts"), () => ({ useAgentPicker: () => ({ agent: "codex-aisdk", model: "gpt-6.1-sol", thinking: "high", label: "Codex", options: [{ id: "codex-aisdk" }], modelOptions: [], thinkingOptions: [], accountOptions: [] }) }));
mock.module(resolve(import.meta.dir, "../src/omg/agent-setup-sheet.tsx"), () => ({ AgentSetupSheet: () => null }));
mock.module(resolve(import.meta.dir, "../src/omg/provider.tsx"), () => ({ useOmg: () => ({ client }) }));
let status: (id: string, state: string) => Promise<void>;
let findings: any[];
let loading = false;
let findingsError: string | null = null;
let refreshes = 0;
mock.module(resolve(import.meta.dir, "../src/omg/auto-agents.ts"), () => ({ useAutoAgents: () => ({ agents: [{ id: "watch", name: "Health watch" }], findings, loading, findingsError, setFindingStatus: (id: string, state: string) => status(id, state), refresh: () => refreshes++ }) }));
const { default: FindingScreen } = await import("../app/auto/[agentId]/[findingId]");
let ui: Mounted;
beforeEach(() => {
  navigation.length = 0; toasts.length = 0; refreshes = 0; loading = false; findingsError = null;
  findings = [{ id: "f1", agentId: "watch", title: "Review the outage", reasoning: ["Error rate increased."], severity: "high" }];
  status = async () => {}; launch = async () => ({ sessionId: "started" }); ui = mount();
});
afterEach(() => ui.cleanup());
function button(text: string) { return ui.queryAll<HTMLButtonElement>("button").find((b) => b.textContent === text)!; }

test("the context link opens the report rather than going back to Home", async () => {
  ui.render(<FindingScreen />);
  await ui.flushAsync(async () => ui.query<HTMLButtonElement>('[aria-label="Open Health watch report, 1 open findings"]')!.click());
  expect(navigation).toEqual(["dismissTo:/auto/watch"]);
  expect(ui.text()).toContain("Why this matters");
});
test("a failed dismissal stays on the finding and explains the error", async () => {
  status = async () => { throw new Error("Computer is offline"); };
  ui.render(<FindingScreen />);
  await ui.flushAsync(async () => ui.query<HTMLButtonElement>('[aria-label="Dismiss finding"]')!.click());
  expect(navigation).toEqual([]); expect(toasts).toEqual(["Computer is offline"]); expect(ui.text()).toContain("Review the outage");
});
test("starting work disables conflicting actions until the new session opens", async () => {
  let finish!: (value: any) => void;
  launch = () => new Promise((resolve) => { finish = resolve; });
  const updates: string[] = []; status = async (_, state) => { updates.push(state); };
  ui.render(<FindingScreen />);
  await ui.flushAsync(async () => button("Start session").click());
  expect(ui.query<HTMLButtonElement>('[aria-label="Dismiss finding"]')!.disabled).toBe(true);
  expect(ui.query<HTMLButtonElement>('[aria-label="Copy finding"]')!.disabled).toBe(true);
  await ui.flushAsync(async () => finish({ sessionId: "started" }));
  expect(updates).toEqual(["session"]); expect(navigation).toEqual(["replace:/session/started"]);
  expect(launchBody).toMatchObject({ agent: "codex-aisdk", model: "gpt-6.1-sol", thinkingLevel: "high" });
});
test("a missing launch id does not mark the finding handled", async () => {
  let updates = 0; status = async () => { updates++; }; launch = async () => ({});
  ui.render(<FindingScreen />);
  await ui.flushAsync(async () => button("Start session").click());
  expect(updates).toBe(0); expect(navigation).toEqual([]); expect(toasts[0]).toContain("The session did not start");
});
test("an already created session opens even if updating the finding fails", async () => {
  status = async () => { throw new Error("status failed"); };
  ui.render(<FindingScreen />);
  await ui.flushAsync(async () => button("Start session").click());
  expect(navigation).toEqual(["replace:/session/started"]); expect(toasts[0]).toContain("Session started");
});
test("a load error offers retry instead of claiming the finding is closed", async () => {
  findings = []; findingsError = "Could not load findings. Please try again.";
  ui.render(<FindingScreen />);
  expect(ui.text()).toContain("Could not load this finding"); expect(ui.text()).not.toContain("This finding is no longer open"); expect(button("Start session")).toBeUndefined();
  await ui.flushAsync(async () => button("Try again").click()); expect(refreshes).toBe(1);
});
test("an old notification offers the current report", async () => {
  findings = []; ui.render(<FindingScreen />);
  expect(ui.text()).toContain("This finding is no longer open");
  await ui.flushAsync(async () => button("View agent findings").click()); expect(navigation).toEqual(["dismissTo:/auto/watch"]);
});
