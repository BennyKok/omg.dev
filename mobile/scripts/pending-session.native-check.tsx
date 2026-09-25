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
const sent: string[] = [];
const client = { sendMessage: async (id: string, text: string) => { sent.push(`${id}:${text}`); return {}; } };
mock.module(resolve(import.meta.dir, "../src/omg/provider.tsx"), () => ({ useOmg: () => ({ client, user: { id: "alice" }, bindingId: "mac" }) }));
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({ Text: View }));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: {}, type: {}, space: {}, radius: {} }) }));
// The real chat screen, stood in for by a stub that shows what it was handed.
// The screen itself is covered elsewhere; this check is about the wiring.
type BodyProps = { screenKey?: string; sessionId: string | null; initialPrompt?: string; initialAgent?: string | null; initialModel?: string | null; onDeliver?: (text: string, mode: "steer" | "queue") => Promise<{ sessionId?: string } | undefined> };
let lastBody: BodyProps | null = null;
mock.module(resolve(import.meta.dir, "../app/session/[id].tsx"), () => ({
  SessionScreenBody: (props: BodyProps) => { lastBody = props; return <div>chat screen {props.initialPrompt} id={props.sessionId ?? "none"} key={props.screenKey}</div>; },
}));
const { startPendingSession, getPendingSession } = await import("../src/omg/pending-session");
const { default: Screen } = await import("../app/session/new");

test("mounts the chat screen with the prompt before POST resolves, then hands it the id in place", async () => {
  let done!: (r: { sessionId: string }) => void;
  request = startPendingSession("alice:mac", "Visible immediately", () => new Promise(r => { done = r; })).token;
  const ui = mount(); routes.length = 0; lastBody = null;
  try {
    ui.render(<Screen />);
    expect(ui.text()).toContain("chat screen Visible immediately id=none");
    expect(ui.text()).not.toContain("Starting conversation");
    const keyBefore = lastBody!.screenKey;
    expect(keyBefore).toBeTruthy();
    expect(lastBody!.onDeliver).toBeTruthy();
    await ui.flushAsync(async () => { await Promise.resolve(); done({ sessionId: "created" }); });
    expect(ui.text()).toContain("chat screen Visible immediately id=created");
    expect(lastBody!.screenKey).toBe(keyBefore);
    expect(lastBody!.onDeliver).toBeUndefined();
    expect(routes).toEqual([]);
  } finally { ui.cleanup(); }
});

test("hands the launched agent and model to the chat header before the id lands", async () => {
  request = startPendingSession("alice:mac", "With a face", () => new Promise(() => {}), { agent: "aisdk", model: "claude-opus-5-5" }).token;
  const ui = mount(); lastBody = null;
  try {
    ui.render(<Screen />);
    expect(lastBody!.initialAgent).toBe("aisdk");
    expect(lastBody!.initialModel).toBe("claude-opus-5-5");
  } finally { ui.cleanup(); }
});

test("a message typed before the id lands is sent to the created session", async () => {
  let done!: (r: { sessionId: string }) => void;
  request = startPendingSession("alice:mac", "Early", () => new Promise(r => { done = r; })).token;
  const ui = mount(); sent.length = 0;
  try {
    ui.render(<Screen />);
    const delivery = lastBody!.onDeliver!("follow up", "steer");
    await Promise.resolve(); // `create` runs in a microtask; let it hand out `done`
    done({ sessionId: "early-id" });
    expect(await delivery).toEqual({ sessionId: "early-id" });
    expect(sent).toEqual(["early-id:follow up"]);
  } finally { ui.cleanup(); }
});

test("an open conversation survives its request being evicted from the stash", async () => {
  // The screen no longer replaces itself, so it outlives the sixteen-entry
  // stash. A later burst of creations must not turn it into the error page.
  let done!: (r: { sessionId: string }) => void;
  request = startPendingSession("alice:mac", "Still mine", () => new Promise(r => { done = r; })).token;
  const ui = mount();
  try {
    ui.render(<Screen />);
    expect(ui.text()).toContain("chat screen Still mine");
    await ui.flushAsync(async () => { await Promise.resolve(); done({ sessionId: "kept" }); });
    for (let i = 0; i < 20; i++) startPendingSession("alice:mac", `Other ${i}`, async () => ({ sessionId: `other-${i}` }));
    expect(getPendingSession(request, "alice:mac")).toBeNull();
    ui.render(<Screen />);
    expect(ui.text()).toContain("chat screen Still mine id=kept");
    expect(ui.text()).not.toContain("no longer available");
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
    expect(ui.text()).not.toContain("chat screen");
    expect(routes).toEqual([]);
  } finally { ui.cleanup(); }
});
