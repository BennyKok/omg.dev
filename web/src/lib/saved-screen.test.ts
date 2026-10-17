import { afterEach, beforeEach, expect, test } from "bun:test";
import { clearSavedScreens, discardSavedScreen, markSavedScreenDrawn, readSavedScreen, trimBootstrapForSaving, writeSavedScreen } from "./saved-screen";

// Failures this must catch:
// - message text, prompts, custom instructions or agent account identities
//   reach browser storage;
// - one account's saved screen is read under another account's key;
// - a copy older than seven days, or a broken one, is drawn;
// - sign-out leaves a saved screen behind;
// - a copy from another app version or format, of the wrong shape, or one
//   whose last draw crashed, reaches the screen.

class MemoryStorage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(i: number) { return [...this.items.keys()][i] ?? null; }
  getItem(k: string) { return this.items.get(k) ?? null; }
  setItem(k: string, v: string) { this.items.set(k, v); }
  removeItem(k: string) { this.items.delete(k); }
  clear() { this.items.clear(); }
}

const original = (globalThis as { localStorage?: Storage }).localStorage;
beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});
afterEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = original;
});

const bootstrap = {
  version: "0.6.247",
  bootId: "boot-1",
  computer: { plan: "computer_10", limit: 4, scheduleLimit: 10 },
  codingAgents: [{ key: "claude", label: "Claude", configured: true, profile: { email: "me@x.test" }, accounts: [{ id: "a" }], installCommand: "npm i", checks: [{ detail: "token ok" }], instructions: ["run login"] }],
  settings: { timeZone: "Asia/Hong_Kong", customInstructions: "my secret" },
  sessions: [{ id: "s1", title: "Fix login", lastUserText: "prompt text", last: "reply text", transcriptPath: "/x", tmuxTarget: "t", pid: 3, conversation: [1] }],
  sessionPins: ["s1"],
  viewer: { managed: true, participantId: "p1", email: "me@x.test", userFilter: "__all" },
  users: [{ email: "me@x.test", name: "Me" }],
  repos: [{ name: "app", cwd: "/home/app" }],
  auto: { tz: "UTC", agents: [{ id: "a1", name: "Daily", prompt: "secret prompt", connectorUser: "me@x.test" }], findings: [{ id: "f1", reasoning: ["log"] }] },
  onboarding: { profiles: [{ email: "me@x.test" }] },
};

test("keeps titles and projects, and drops text, instructions, accounts and findings", () => {
  const kept = JSON.stringify(trimBootstrapForSaving(bootstrap));
  for (const secret of ["prompt text", "reply text", "my secret", "secret prompt", "token ok", "npm i", "run login", "boot-1", "f1", '"version"']) {
    expect(kept).not.toContain(secret);
  }
  const trimmed = trimBootstrapForSaving(bootstrap) as Record<string, any>;
  expect(trimmed.sessions[0]).toEqual({ id: "s1", title: "Fix login" });
  expect(trimmed.codingAgents[0]).toEqual({ key: "claude", label: "Claude", configured: true, checks: [], instructions: [] });
  expect(trimmed.viewer).toEqual({ managed: true, participantId: "p1" });
  expect(trimmed.repos).toEqual(bootstrap.repos);
  expect(trimmed.settings).toEqual({ timeZone: "Asia/Hong_Kong" });
});

const read = (key: string, now?: number) => {
  const saved = readSavedScreen(key, now);
  if (saved) markSavedScreenDrawn(key);
  return saved;
};

test("reads back only under the same key", () => {
  writeSavedScreen("user-a:cloud", bootstrap, 1_000);
  expect(read("user-a:cloud", 2_000)?.payload.sessions).toEqual([{ id: "s1", title: "Fix login" }]);
  expect(read("user-b:cloud", 2_000)).toBeNull();
});

test("a copy whose last draw never completed is discarded", () => {
  writeSavedScreen("user-a:cloud", bootstrap);
  expect(readSavedScreen("user-a:cloud")).not.toBeNull();
  // The page crashed before markSavedScreenDrawn: the next load draws nothing.
  expect(readSavedScreen("user-a:cloud")).toBeNull();
  expect(localStorage.getItem("omg:saved-screen:v1:user-a:cloud")).toBeNull();
});

test("a copy from another app version or format, or of the wrong shape, is discarded", () => {
  const key = "omg:saved-screen:v1:user-a:cloud";
  writeSavedScreen("user-a:cloud", bootstrap);
  const good = JSON.parse(localStorage.getItem(key)!);
  for (const bad of [
    { ...good, app: "0.0.1-other" },
    { ...good, format: 99 },
    { ...good, payload: { ...good.payload, sessions: "not a list" } },
    { ...good, payload: { ...good.payload, sessions: [{ title: "no id" }] } },
    { ...good, payload: { ...good.payload, auto: { agents: [1, 2] } } },
  ]) {
    localStorage.setItem(key, JSON.stringify(bad));
    expect(readSavedScreen("user-a:cloud")).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  }
  discardSavedScreen("user-a:cloud");
});

test("drops a copy older than seven days, or a broken one", () => {
  writeSavedScreen("user-a:cloud", bootstrap, 0);
  expect(read("user-a:cloud", 8 * 24 * 60 * 60 * 1000)).toBeNull();
  expect(localStorage.getItem("omg:saved-screen:v1:user-a:cloud")).toBeNull();
  localStorage.setItem("omg:saved-screen:v1:user-a:cloud", "{not json");
  expect(read("user-a:cloud")).toBeNull();
});

test("clears every saved screen on sign-out, or all but the kept account", () => {
  writeSavedScreen("user-a:cloud", bootstrap);
  writeSavedScreen("user-b:cloud", bootstrap);
  localStorage.setItem("lfg_theme", "dark");
  clearSavedScreens((key) => key.startsWith("user-a:"));
  expect(read("user-a:cloud")).not.toBeNull();
  expect(read("user-b:cloud")).toBeNull();
  clearSavedScreens();
  expect(read("user-a:cloud")).toBeNull();
  expect(localStorage.getItem("lfg_theme")).toBe("dark");
});
