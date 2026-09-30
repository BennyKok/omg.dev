import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Runs the Expo template's route check on small project trees. In a real
// DeepSeek build the agent wrote app/(tabs)/index.tsx next to the template's
// src/app/index.tsx, and "/" kept showing the template to-do app.

const TEMPLATE = join(import.meta.dir, "..", "agents", "templates", "expo");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "expo-routes-"));
  dirs.push(dir);
  cpSync(join(TEMPLATE, "scripts"), join(dir, "scripts"), { recursive: true });
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "export default function Screen() { return null; }\n");
  }
  return dir;
}

function check(dir: string) {
  const run = Bun.spawnSync(["node", join(dir, "scripts", "check-routes.mjs")]);
  return { code: run.exitCode, out: `${run.stdout}${run.stderr}` };
}

test("the shipped template has exactly one home route", () => {
  const run = Bun.spawnSync(["node", join(TEMPLATE, "scripts", "check-routes.mjs")]);
  expect(`${run.stdout}`).toContain("ROUTES: OK");
  expect(run.exitCode).toBe(0);
});

test("a tabs home next to the template home fails and names both files", () => {
  const { code, out } = check(project(["src/app/_layout.tsx", "src/app/index.tsx", "src/app/(tabs)/_layout.tsx", "src/app/(tabs)/index.tsx"]));
  expect(code).toBe(1);
  expect(out).toContain('Several files answer "/"');
  expect(out).toContain("src/app/(tabs)/index");
  expect(out).toContain("src/app/index");
});

test("screens written under a root app/ folder fail, because Expo Router ignores it", () => {
  const { code, out } = check(project(["src/app/index.tsx", "app/(tabs)/index.tsx"]));
  expect(code).toBe(1);
  expect(out).toContain("root app/ folder");
});

test("tabs that replace the template home pass, and platform variants are one route", () => {
  const { code, out } = check(project([
    "src/app/_layout.tsx",
    "src/app/+not-found.tsx",
    "src/app/(tabs)/_layout.tsx",
    "src/app/(tabs)/index.tsx",
    "src/app/(tabs)/index.web.tsx",
    "src/app/(tabs)/stats.tsx",
    "src/app/api/items+api.ts",
  ]));
  expect(out).toContain("ROUTES: OK");
  expect(code).toBe(0);
});

test("a nested duplicate outside the home route also fails", () => {
  const { code, out } = check(project(["src/app/index.tsx", "src/app/stats.tsx", "src/app/(more)/stats.tsx"]));
  expect(code).toBe(1);
  expect(out).toContain('Several files answer "/stats"');
});
