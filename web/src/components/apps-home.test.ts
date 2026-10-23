// The Apps view files each session under the app its folder links to. A
// session under the wrong app sends the person's next change to the wrong
// folder, and a dropped folder hides work in progress.
import { expect, test } from "bun:test";
import { buildAppItems } from "./apps-home";

type R = { cwd: string; project?: string; deploy?: { slug: string; url: string; name?: string } };
const repos: R[] = [
  { cwd: "/r/snake", project: "snake", deploy: { slug: "snake-1", url: "https://snake-1.omgs.app", name: "Snake" } },
  { cwd: "/r/tea", project: "tea", deploy: { slug: "tea-1", url: "https://tea-1.omgs.app" } },
  { cwd: "/r/notes", project: "notes" },
  { cwd: "/r/idle", project: "idle" },
];
const sessions = [
  { sessionId: "a", cwd: "/r/snake/src", lastActivityAt: 5 },
  { sessionId: "b", cwd: "/w/tea-dark", project: "tea", lastActivityAt: 9 },
  { sessionId: "c", cwd: "/r/notes", lastActivityAt: 3 },
  { sessionId: "d", cwd: "/chats/x", lastActivityAt: 1 },
];
const cloud = new Map([["tea-1", { slug: "tea-1", name: "Tea list", appKind: "game" as const, isLive: true }]]);

test("sessions go to the linked app by folder or worktree project; unlinked folders are not apps", () => {
  const home = buildAppItems(repos, sessions, cloud, (repo) => repo.project ?? repo.cwd);
  const ids = (items: typeof home.apps) => items.map((item) => [item.project, item.sessions.map((s) => s.sessionId)]);
  // The hosted kind wins over the name; "tea" is filed as a game by its owner.
  expect(ids(home.games)).toEqual([["tea", ["b"]]]);
  expect(home.games[0].name).toBe("Tea list");
  expect(home.games[0].isLive).toBe(true);
  expect(ids(home.apps)).toEqual([["snake", ["a"]]]);
  expect([...home.games, ...home.apps].map((item) => item.project)).not.toContain("notes");
});

// The questnest replay: the session that built the app ran in a folder labelled
// "project", so the app's page missed it and the owner built the app again.
test("the session that built an app is listed under it, whatever folder it ran in", () => {
  const built = { sessionId: "q1", cwd: "/r/notes", project: "project", lastActivityAt: 7 };
  const withBuilder = new Map([...cloud, ["snake-1", { slug: "snake-1", name: "Snake", builtBySessionId: "q1" }]]);
  const home = buildAppItems(repos, [...sessions, built], withBuilder, (repo) => repo.project ?? repo.cwd);
  const snake = home.apps.find((item) => item.project === "snake")!;
  expect(snake.sessions.map((s) => s.sessionId)).toEqual(["q1", "a"]);
});

// The Apps page lists projects on this Computer (lfg, vibes) under "On this
// computer". Each must keep its own sessions, and a session that built a
// published app must not be counted under a local folder too.
test("a folder with no published app is a local project with its own sessions", () => {
  const home = buildAppItems(repos, sessions, cloud, (repo) => repo.project ?? repo.cwd);
  const local = Object.fromEntries(home.local.map((item) => [item.project, item.sessions.map((s) => s.sessionId)]));
  expect(local).toEqual({ notes: ["c"], idle: [] });
  expect(home.local.map((item) => item.project)).not.toContain("snake");
});

test("one list: recent work first, then the newest app, whatever its kind", () => {
  const three: R[] = [
    { cwd: "/r/old", project: "old", deploy: { slug: "old-1", url: "https://old-1.omgs.app" } },
    { cwd: "/r/new", project: "new", deploy: { slug: "new-1", url: "https://new-1.omgs.app" } },
    { cwd: "/r/busy", project: "busy", deploy: { slug: "busy-1", url: "https://busy-1.omgs.app" } },
  ];
  // The Cloud sends the newest app first.
  const order = new Map([
    ["new-1", { slug: "new-1", name: "New", appKind: "game" as const }],
    ["busy-1", { slug: "busy-1", name: "Busy" }],
    ["old-1", { slug: "old-1", name: "Old" }],
  ]);
  const home = buildAppItems(three, [{ sessionId: "s", cwd: "/r/busy", lastActivityAt: 4 }], order, (repo) => repo.project ?? repo.cwd);
  expect(home.all.map((item) => item.project)).toEqual(["busy", "new", "old"]);
});
