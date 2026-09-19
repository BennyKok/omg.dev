/** Run from mobile/: bun scripts/benchmark-session-activity.ts [--production]
 * Keep the benchmark entry out of the product bundle. Restore package.json
 * when Metro exits or this process receives a termination signal.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const manifest = resolve(root, "package.json");
const original = readFileSync(manifest, "utf8");
const pkg = JSON.parse(original);
const productEntry = pkg.main;
if (pkg.main !== "expo-router/entry") throw new Error("Expected the product entry; another benchmark may be running.");
const output = resolve(process.env.ACTIVITY_PERF_OUTPUT ?? "session-activity-perf.jsonl");
const production = process.argv.includes("--production");
const runId = crypto.randomUUID();
const recorded = new Set<number>();
const collector = Bun.serve({
  hostname: "127.0.0.1", port: 8095,
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/result") return new Response("Not found", { status: 404 });
    const row = await request.json();
    // A terminated client's queued POST can arrive after the next collector
    // starts. Keep runs separate and make report retries idempotent.
    if (row.runId !== runId) return new Response("Stale benchmark run", { status: 409 });
    if (recorded.has(row.trial)) return new Response("ok");
    appendFileSync(output, JSON.stringify(row) + "\n");
    recorded.add(row.trial);
    console.log("Recorded trial", row.trial, "rows:", row.rows, "paused:", row.paused, "dev:", row.dev);
    return new Response("ok");
  },
});
let metro: ReturnType<typeof Bun.spawn> | undefined;
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  metro?.kill();
  collector.stop(true);
  // Preserve any other edits made while the harness was running.
  const current = JSON.parse(readFileSync(manifest, "utf8"));
  if (current.main === "bench/session-activity-entry.tsx") {
    current.main = productEntry;
    writeFileSync(manifest, JSON.stringify(current, null, 2) + "\n");
  }
};
try {
  pkg.main = "bench/session-activity-entry.tsx";
  writeFileSync(manifest, JSON.stringify(pkg, null, 2) + "\n");
  process.on("SIGINT", () => { restore(); process.exit(130); });
  process.on("SIGTERM", () => { restore(); process.exit(143); });
  metro = Bun.spawn(["node", "node_modules/.bin/expo", "start", "--clear", "--localhost", "--port", "8094", ...(production ? ["--no-dev", "--minify"] : [])], {
    cwd: root, env: { ...process.env, CI: "1", EXPO_PUBLIC_OMG_ACTIVITY_RUN_ID: runId, REACT_NATIVE_PACKAGER_HOSTNAME: "localhost" },
    stdout: "inherit", stderr: "inherit",
  });
  console.log("Results:", output);
  process.exitCode = await metro.exited;
} finally { restore(); }
