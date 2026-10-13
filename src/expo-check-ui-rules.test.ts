import { join } from "node:path";
import { expect, test } from "bun:test";

// The rules module is plain JS shipped in the Expo template; load it without type declarations.
const rules: any = await import(join(import.meta.dir, "..", "agents", "templates", "expo", "scripts", "check-ui-rules.mjs"));

test("discoverRoutes maps export files to routes and skips non-screens", () => {
  const out = rules.discoverRoutes(["index.html", "settings.html", "lists/index.html", "lists/[id].html", "task/new.html", "+not-found.html", "_sitemap.html", "_expo/static/x.js", "assets/a.png"]);
  expect(out.routes).toEqual(["/", "/lists", "/settings", "/task/new"]);
  expect(out.skipped).toEqual(["/lists/[id]"]);
});

test("routeFileName gives flat PNG names", () => {
  expect(rules.routeFileName("/")).toBe("index");
  expect(rules.routeFileName("/task/new")).toBe("task_new");
});

test("judgePage flags blank pages and error boundaries only", () => {
  expect(rules.judgePage({ text: "  \n", media: 0 }).blank).toBe(true);
  expect(rules.judgePage({ text: "", media: 2 }).blank).toBe(false);
  expect(rules.judgePage({ text: "Today\nAdd Task", media: 0 })).toMatchObject({ blank: false, errorBoundary: false });
  expect(rules.judgePage({ text: "Something went wrong", media: 0 }).errorBoundary).toBe(true);
  expect(rules.judgePage({ text: "Unmatched Route\nPage could not be found.", media: 0 }).errorBoundary).toBe(true);
});

test("coveredElements keeps only elements that another element covers", () => {
  const els = [
    { label: "ok", relation: "self", at: { x: 1, y: 1 } },
    { label: "row", relation: "descendant", at: { x: 1, y: 2 } },
    { label: "Add Task", relation: "other", by: "Tab bar", at: { x: 195, y: 800 } },
    { label: "gone", relation: "none", at: { x: 1, y: 3 } },
  ];
  expect(rules.coveredElements(els)).toEqual([{ label: "Add Task", by: "Tab bar", at: { x: 195, y: 800 } }]);
});

test("routeFailed fails on blank, error boundary or load error", () => {
  expect(rules.routeFailed({ blank: false, errorBoundary: false })).toBe(false);
  expect(rules.routeFailed({ blank: true })).toBe(true);
  expect(rules.routeFailed({ errorBoundary: true })).toBe(true);
  expect(rules.routeFailed({ loadError: "x" })).toBe(true);
});

test("server output helpers", () => {
  expect(rules.announcedPort("listening on http://127.0.0.1:8801 (data)")).toBe(8801);
  expect(rules.announcedPort("nothing yet")).toBeUndefined();
  const lines = rules.firstErrorLines("starting\nerror: Expected \";\" but found \"X\"\n  at a.mjs:3\nmore");
  expect(lines[0]).toContain("Expected");
});
