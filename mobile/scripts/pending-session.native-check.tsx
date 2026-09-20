/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
const View = ({ children }: any) => <div>{children}</div>;
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({ View, ScrollView: View, ActivityIndicator: () => <span>busy</span>, Pressable: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button> }));
const routes: string[] = [];
let request = "";
const router = { replace: (path: string) => routes.push(path), back: () => {} };
mock.module(import.meta.resolve("expo-router"), () => ({ Stack: { Screen: () => null }, useRouter: () => router, useLocalSearchParams: () => ({ request }) }));
mock.module(import.meta.resolve("react-native-safe-area-context"), () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
mock.module(resolve(import.meta.dir, "../src/omg/provider.tsx"), () => ({ useOmg: () => ({ user: { id: "alice" }, bindingId: "mac" }) }));
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({ Text: View }));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: {}, type: {}, space: {}, radius: {} }) }));
const { startPendingSession } = await import("../src/omg/pending-session");
const { default: Screen } = await import("../app/session/new");
test("renders submitted prompt before POST resolves, then opens created conversation", async () => {
  let done!: (r: { sessionId: string }) => void;
  request = startPendingSession("alice:mac", "Visible immediately", () => new Promise(r => { done = r; })).token;
  const ui = mount(); routes.length = 0;
  try {
    ui.render(<Screen />);
    expect(ui.text()).toContain("Visible immediately");
    expect(ui.text()).toContain("Starting conversation");
    expect(routes).toEqual([]);
    await ui.flushAsync(async () => { await Promise.resolve(); done({ sessionId: "created" }); });
    expect(routes).toEqual(["/session/created"]);
  } finally { ui.cleanup(); }
});
test("leaving during creation does not pull the reader back when it completes", async () => {
  let done!: (r: { sessionId: string }) => void;
  request = startPendingSession("alice:mac", "Keep going", () => new Promise(r => { done = r; })).token;
  const ui = mount(); routes.length = 0;
  ui.render(<Screen />); ui.cleanup();
  await Promise.resolve(); done({ sessionId: "late" });
  await Promise.resolve(); await Promise.resolve();
  expect(routes).toEqual([]);
});

test("creation errors leave the submitted prompt readable", async () => {
  request = startPendingSession("alice:mac", "Do not lose this", async () => { throw Error("Connection lost"); }).token;
  const ui = mount(); routes.length = 0;
  try {
    ui.render(<Screen />);
    await ui.flushAsync(async () => { await Promise.resolve(); });
    expect(ui.text()).toContain("Do not lose this");
    expect(ui.text()).toContain("Connection lost");
    expect(routes).toEqual([]);
  } finally { ui.cleanup(); }
});
