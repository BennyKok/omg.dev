import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { installProjectTemplate, isProjectTemplate, PROJECT_GAME_SKILL } from "./project-starter";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(homedir(), ".cache", "lfg", "tmp", "starter-"));
  dirs.push(dir);
  return dir;
}

test("expo-game is a project template", () => {
  expect(isProjectTemplate("expo-game")).toBe(true);
  expect(isProjectTemplate("game")).toBe(false);
});

test("expo-game installs the Expo base, the game kit and the game skill", async () => {
  const cwd = scratch();
  await installProjectTemplate(cwd, "expo-game", "Neon Racer");
  // Base files come from the expo template.
  for (const file of ["app.json", "eas.json", "scripts/check-routes.mjs", "src/lib/keyboard.tsx"]) expect(existsSync(join(cwd, file))).toBe(true);
  // Kit files and the sample game.
  for (const file of ["src/game/loop.ts", "src/game/input.ts", "src/components/controls.tsx", "src/games/coin-dash/logic.ts", "tests/kit.test.ts", PROJECT_GAME_SKILL]) {
    expect(existsSync(join(cwd, file))).toBe(true);
  }
  // The overlay replaces the base home screen and the base to-do data file is not the home screen.
  expect(readFileSync(join(cwd, "src/app/index.tsx"), "utf8")).toContain("MenuScreen");
  expect(readFileSync(join(cwd, "src/game/profile-store.ts"), "utf8")).toContain("neon-racer:profile");
  expect(readFileSync(join(cwd, "README.md"), "utf8")).toContain("# Neon Racer");
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  expect(pkg.name).toBe("neon-racer");
  expect(pkg.scripts.test).toBe("bun test");
  expect(pkg.scripts.typecheck).toContain("check-routes");
  expect(JSON.parse(readFileSync(join(cwd, ".omg/template.json"), "utf8")).name).toBe("expo-game");
});

test("the plain expo template has no game kit", async () => {
  const cwd = scratch();
  await installProjectTemplate(cwd, "expo", "Plain");
  expect(existsSync(join(cwd, "src/game"))).toBe(false);
  expect(existsSync(join(cwd, PROJECT_GAME_SKILL))).toBe(false);
});
