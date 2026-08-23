import { join } from "node:path";
import {
  EMBED_TEST_BUILDS,
  staleTestBuildCommands,
  TEST_BUILDS,
  testBuildPrerequisiteError,
  unreadyTestBuilds,
} from "./test-builds";

const root = join(import.meta.dir, "..");

// `--with-embed` adds the prebuilt @omg-dev/app bundle. That is the ~30s,
// 1.7 GB-resident vite build, so it is opt-in and belongs to `test:embed`
// and the release workflow, not to every `bun run test`.
const builds = process.argv.includes("--with-embed") ? EMBED_TEST_BUILDS : TEST_BUILDS;
const before = unreadyTestBuilds(root, builds);

// Only what is actually stale. This used to run the whole build:packages
// script for any single stale output — every package plus the web library
// bundle, which is a ~1GB vite build. Since `web/dist-lib` lists `web/src` as
// an input, every test run after touching the UI rebuilt all of it. Three
// worktrees doing that at once took this box to load 44 at 24% iowait with
// nothing finishing.
if (before.length > 0) {
  const commands = staleTestBuildCommands(root, builds);
  console.log(
    `Building ${commands.length} stale test prerequisite${commands.length === 1 ? "" : "s"}: ${before.join(", ")}`,
  );
  for (const command of commands) {
    const result = Bun.spawnSync([process.execPath, ...command], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Test prerequisite build failed (${command.join(" ")}) with exit code ${result.exitCode}.`,
      );
    }
  }
}

const after = unreadyTestBuilds(root, builds);
if (after.length > 0) throw testBuildPrerequisiteError(after);
