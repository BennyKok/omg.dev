#!/usr/bin/env bun
/**
 * Run every native behaviour check, and say out loud which ones are not run.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `test:native` was `bun test ./scripts/*.native-check.ts`. That glob does not
 * match `.tsx`, and EIGHT check files have that extension -- including the
 * composer's and the session activity grid's. They ran nowhere.
 *
 * This is the second time this exact trap has been hit here: mobile/AGENTS.md
 * already records `bun test` not discovering the `.native-check` suffix at
 * all, and the fix then was this same script entry. The suffix was fixed; the
 * extension was not.
 *
 * ── One process per file ──────────────────────────────────────────────────
 *
 * These checks mock modules globally -- react-native, expo-router, reanimated
 * -- and each file's mocks are tuned to the graph that file pulls in. Batched
 * into one process they trample each other: all eight `.tsx` checks pass alone
 * and sixteen assertions fail when run together. So each file gets its own
 * process. It costs a few seconds and buys a result that means something.
 *
 * ── Quarantine is explicit, and it is not a pass ──────────────────────────
 *
 * A skipped file is printed, counted and listed at the end. It must never be
 * possible to read a green run as "everything is checked".
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Files that cannot run, with the reason. Empty is the goal.
 *
 * Nothing here is "expected to fail" -- a check that fails belongs fixed or
 * deleted. These are checks whose HARNESS is broken, so they never get as far
 * as asserting anything.
 */
const QUARANTINE: Record<string, string> = {
  "transcript-body.native-check.tsx":
    "Harness rot: its react-native and expo-router mocks predate the module graph the component now pulls in, so it dies at import on a missing named export (__DEV__, then router, then TurboModuleRegistry, each revealed by fixing the last). It has never run in CI, so this is not a regression. Fixing it means rebuilding its mocks.",
};

const files = readdirSync(import.meta.dir)
  .filter((name) => name.includes(".native-check."))
  .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
  .sort();

let failed = 0;
let ran = 0;
for (const name of files) {
  if (QUARANTINE[name]) continue;
  ran += 1;
  const result = Bun.spawnSync(["bun", "test", join(import.meta.dir, name)], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) failed += 1;
}

const skipped = files.filter((name) => QUARANTINE[name]);
if (skipped.length) {
  console.log(`\n${skipped.length} check file(s) NOT RUN:`);
  for (const name of skipped) console.log(`  - ${name}\n    ${QUARANTINE[name]}`);
}
console.log(`\n${ran} check file(s) ran, ${failed} failed, ${skipped.length} quarantined.`);
process.exit(failed > 0 ? 1 : 0);
