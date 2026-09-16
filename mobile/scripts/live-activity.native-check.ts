import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const require = createRequire(import.meta.url);
const { transformFileSync } = require("@babel/core");
const { code } = transformFileSync(new URL("../src/omg/agent-live-activity.tsx", import.meta.url).pathname, {
  configFile: false, babelrc: false, presets: [require.resolve("babel-preset-expo")],
  caller: { name: "metro", platform: "ios", isDev: false, isServer: false },
});
let layout = "";
runInNewContext(code, { exports: {}, require: (name: string) => name === "expo-widgets"
  ? { createLiveActivity: (_name: string, compiled: string) => { layout = compiled; } }
  : name.includes("interopRequireWildcard") ? { default: (value: unknown) => value }
  : name.includes("interopRequireDefault") ? { default: (value: unknown) => value } : {} });
const jsx = (type: string, props: any) => ({ type, props });
const globals: Record<string, any> = { _jsx: jsx, _jsxs: jsx };
for (const type of ["Circle", "HStack", "Image", "ProgressView", "Spacer", "Text", "VStack"]) globals[type] = type;
for (const type of ["background", "bold", "cornerRadius", "font", "foregroundColor", "frame", "lineLimit", "padding", "progressViewStyle", "resizable", "widgetURL"]) globals[type] = (value: unknown) => ({ type, value });
const render = runInNewContext(`(${layout})`, globals);
function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}
const props = { machineName: "Benny's Mac", runningCount: 2, blockedCount: 1, attentionSessionId: "blocked", updatedAt: 1,
  sessions: [
    { id: "blocked", title: "Fix APNs registration", agent: "codex-aisdk", state: "blocked" },
    { id: "working", title: "Refactor worktree cleanup and lease handling", agent: "claude", state: "working" },
    { id: "done", title: "", agent: "cursor", state: "done" },
  ], sessionCount: 3 };
for (const colorScheme of ["light", "dark"]) test(`isolated ${colorScheme} layout shows titles, marks, and states`, () => {
  const result = render(props, { colorScheme });
  const tree = nodes(result.banner);
  const texts = tree.filter(n => n.type === "Text").map(n => n.props.children);
  expect(texts).toContain("Fix APNs registration");
  expect(texts).toContain("needs you");
  expect(texts).not.toContain("Cursor");
  expect(texts).not.toContain("done");
  expect(texts).not.toContain("blocked");
  expect(tree.filter(n => n.type === "Image").map(n => n.props.assetName)).toEqual(["agent-codex", "agent-claude"]);
  expect(nodes(result.compactLeading).filter(n => n.type === "Image")).toHaveLength(2);
  expect(nodes(result.expandedBottom).filter(n => n.type === "Image")).toHaveLength(2);
});
test("inactive roster totals are hidden, old payloads render, and unknown agents wear the Claude mark", () => {
  const result = render({ ...props, sessionCount: 8 }, { colorScheme: "dark" });
  expect(nodes(result.banner).filter(n => n.type === "Image")).toHaveLength(2);
  expect(nodes(result.banner).some(n => String(n.props?.children).includes("more sessions"))).toBe(false);
  expect(() => render({ ...props, sessions: undefined }, { colorScheme: "light" })).not.toThrow();
  const unknown = render({ ...props, sessions: [{ id: "unknown", title: "", agent: "unknown", state: "working" }] }, { colorScheme: "light" });
  // Claude, not omg: the web's agentIconSrc falls back to the Claude mark and
  // this surface used to disagree with it. See the per-agent cases below.
  expect(nodes(unknown.minimal)[0].props.assetName).toBe("agent-claude");
});

function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
for (const colorScheme of ["light", "dark"]) test(`${colorScheme} text stays readable on dark activity surfaces`, () => {
  const result = render(props, { colorScheme });
  for (const section of Object.values(result)) for (const node of nodes(section).filter(n => n.type === "Text")) {
    const color = node.props.modifiers.find((m: any) => m.type === "foregroundColor")?.value;
    expect(typeof color).toBe("string");
    for (const surface of ["#000000", "#20211E", "#33271F"]) {
      expect((luminance(color) + 0.05) / (luminance(surface) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  }
});
test("finished rows cannot crowd out active rows", () => {
  const result = render({ ...props, sessions: [props.sessions[2], props.sessions[2], props.sessions[2], props.sessions[0]] }, {colorScheme:"light"});
  const texts = nodes(result.banner).filter(n => n.type === "Text").map(n => n.props.children);
  expect(texts).toContain("Fix APNs registration");
  expect(texts).not.toContain("done");
});

/**
 * THE RIGHT-HAND COLUMN COUNTS, it does not say "working".
 *
 * The timer is counted by SwiftUI on the device from `startedAt`, so the row
 * climbs every second with no push behind it. A Live Activity is updated over
 * APNs and a per-second push is neither allowed nor affordable, so losing the
 * interval would quietly turn a live number into a frozen one.
 */
const running = (extra: Record<string, unknown>) => nodes(render({
  machineName: "Mac", runningCount: 1, blockedCount: 0, attentionSessionId: null,
  updatedAt: 1, sessionCount: 1,
  sessions: [{ id: "s1", title: "Fix the widget", agent: "claude", state: "working", ...extra }],
}, { colorScheme: "dark" }).banner);

test("a running session shows an elapsed timer counting up from its start", () => {
  const started = 1_700_000_000_000;
  const timer = running({ startedAt: started }).find(node => node.type === "Text" && node.props.timerInterval);
  expect(timer).toBeDefined();
  expect(timer.props.countsDown).toBe(false);
  expect(new Date(timer.props.timerInterval.lower).getTime()).toBe(started);
  // The upper bound is out of reach, because a run has no known end.
  expect(new Date(timer.props.timerInterval.upper).getTime()).toBeGreaterThan(started + 300 * 24 * 3600 * 1000);
});

/**
 * NO RING BESIDE THE CLOCK. Both kinds were tried and both failed the same way.
 *
 * An indeterminate spinner draws as a static empty ring on a Lock Screen,
 * because a Live Activity runs no animation loop. A determinate
 * `ProgressView(timerInterval:)` does animate -- but against any flat horizon
 * a coding run pins it at full within minutes and it spends the rest of the
 * session as an unmoving disc, which is the same thing the first one drew.
 *
 * So the rule is the broad one again, and this time it is broad because the
 * narrow version was tried in production and removed. The clock is the running
 * signal; it moves, and it is exact.
 */
test("no progress ring is rendered in any state", () => {
  for (const startedAt of [1_700_000_000_000, null, undefined, 0]) {
    expect(running({ startedAt }).filter(node => node.type === "ProgressView")).toHaveLength(0);
  }
  const blocked = nodes(render({
    machineName: "Mac", runningCount: 0, blockedCount: 1, attentionSessionId: "s1",
    updatedAt: 1, sessionCount: 1,
    sessions: [{ id: "s1", title: "Waiting", agent: "claude", state: "blocked", startedAt: 1_700_000_000_000 }],
  }, { colorScheme: "dark" }).banner);
  expect(blocked.filter(node => node.type === "ProgressView")).toHaveLength(0);
});

test("a session the box never stamped falls back to a word, not 1970", () => {
  for (const missing of [null, undefined, 0]) {
    const tree = running({ startedAt: missing });
    expect(tree.find(node => node.type === "Text" && node.props.timerInterval)).toBeUndefined();
    expect(tree.map(node => node.props?.children)).toContain("working");
  }
});

test("a blocked session still asks for you rather than counting", () => {
  const tree = nodes(render({
    machineName: "Mac", runningCount: 0, blockedCount: 1, attentionSessionId: "s1",
    updatedAt: 1, sessionCount: 1,
    sessions: [{ id: "s1", title: "Waiting", agent: "claude", state: "blocked", startedAt: 1_700_000_000_000 }],
  }, { colorScheme: "dark" }).banner);
  expect(tree.find(node => node.type === "Text" && node.props.timerInterval)).toBeUndefined();
  expect(tree.map(node => node.props?.children)).toContain("needs you");
});

/**
 * The same session must not show a different face per surface. `aisdk` is the
 * Claude runner and the server's default agent; this resolved it, and every
 * unknown agent, to the omg mark while the web and the widget showed Claude.
 */
for (const [agent, mark] of [
  ["aisdk", "agent-claude"],
  ["codex-aisdk", "agent-codex"],
  ["codex", "agent-codex"],
  ["cursor", "agent-cursor"],
  ["", "agent-claude"],
  ["something-new", "agent-claude"],
] as const) {
  test(`"${agent}" wears ${mark}, the same as the web`, () => {
    const tree = nodes(render({
      machineName: "Mac", runningCount: 1, blockedCount: 0, attentionSessionId: null,
      updatedAt: 1, sessionCount: 1,
      sessions: [{ id: "s1", title: "t", agent, state: "working", startedAt: 1 }],
    }, { colorScheme: "dark" }).banner);
    expect(tree.find(node => node.type === "Image")?.props.assetName).toBe(mark);
  });
}
