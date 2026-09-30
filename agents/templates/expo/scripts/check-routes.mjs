#!/usr/bin/env node
// Fail when the Expo Router tree is ambiguous, so a new home screen cannot
// hide behind the template one.
//
//   node scripts/check-routes.mjs
//
// Two mistakes left the template to-do app on "/" in a real build:
// 1. Screens written under a root `app/` folder. Expo CLI uses `src/app` when
//    it exists and ignores `app/` without a warning.
// 2. Two files for the same URL, such as `src/app/index.tsx` and
//    `src/app/(tabs)/index.tsx`. Groups in parentheses do not change the URL.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routerRoot = join(root, "src", "app");
const problems = [];

if (!existsSync(routerRoot)) {
  problems.push("src/app is missing. Keep every screen in src/app; Expo Router reads routes from there.");
} else {
  if (existsSync(join(root, "app")) && statSync(join(root, "app")).isDirectory()) {
    problems.push(
      "A root app/ folder exists next to src/app. Expo Router ignores app/ while src/app exists, so its screens never show. Move them into src/app and delete app/.",
    );
  }

  const routes = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const match = /^(.*?)(\.(ios|android|web|native))?\.(tsx|ts|jsx|js)$/.exec(entry.name);
      // Layouts, +html, +not-found, +api and other + files are not screens.
      if (!match || match[1].startsWith("_") || match[1].includes("+")) continue;
      const segments = relative(routerRoot, join(dir, match[1]))
        .split(/[\\/]/)
        .filter((segment) => !/^\(.*\)$/.test(segment));
      if (segments.at(-1) === "index") segments.pop();
      const url = `/${segments.join("/")}`;
      // index.tsx and index.web.tsx are one route with platform variants.
      const file = relative(root, join(dir, match[1]));
      const files = routes.get(url) ?? new Set();
      files.add(file);
      routes.set(url, files);
    }
  };
  walk(routerRoot);

  if (!routes.has("/")) problems.push('No screen answers "/". Keep exactly one home screen, such as src/app/index.tsx.');
  for (const [url, files] of routes) {
    if (files.size < 2) continue;
    problems.push(
      `Several files answer "${url}": ${[...files].sort().join(", ")}. Keep one and delete the others. ` +
        `For tabs, move the home screen to src/app/(tabs)/index.tsx and delete src/app/index.tsx.`,
    );
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`ROUTES: ${problem}`);
  process.exit(1);
}
console.log("ROUTES: OK");
