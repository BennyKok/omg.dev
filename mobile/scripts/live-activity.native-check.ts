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
for (const type of ["Circle", "HStack", "Image", "Spacer", "Text", "VStack"]) globals[type] = type;
for (const type of ["background", "bold", "cornerRadius", "font", "foregroundColor", "frame", "lineLimit", "padding", "resizable", "widgetURL"]) globals[type] = (value: unknown) => ({ type, value });
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
  expect(texts).toContain("Cursor");
  expect(texts).not.toContain("blocked");
  expect(tree.filter(n => n.type === "Image").map(n => n.props.assetName)).toEqual(["agent-codex", "agent-claude", "agent-cursor"]);
  expect(nodes(result.compactLeading).filter(n => n.type === "Image")).toHaveLength(3);
  expect(nodes(result.expandedBottom).filter(n => n.type === "Image")).toHaveLength(3);
});
test("overflow reserves the final lane, old payloads render, and unknown agents have a mark", () => {
  const result = render({ ...props, sessionCount: 8 }, { colorScheme: "dark" });
  expect(nodes(result.banner).filter(n => n.type === "Image")).toHaveLength(2);
  expect(nodes(result.banner).some(n => n.props.children === "+6")).toBe(true);
  expect(() => render({ ...props, sessions: undefined }, { colorScheme: "light" })).not.toThrow();
  const unknown = render({ ...props, sessions: [{ id: "unknown", title: "", agent: "unknown", state: "working" }] }, { colorScheme: "light" });
  expect(nodes(unknown.minimal)[0].props.assetName).toBe("agent-omg");
});
