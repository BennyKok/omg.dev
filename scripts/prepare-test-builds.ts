import { join } from "node:path";
import { testBuildPrerequisiteError, unreadyTestBuilds } from "./test-builds";

const root = join(import.meta.dir, "..");
const before = unreadyTestBuilds(root);

if (before.length > 0) {
  console.log("Building test prerequisites before test discovery...");
  const result = Bun.spawnSync([process.execPath, "run", "build:packages"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Test prerequisite build failed with exit code ${result.exitCode}.`);
  }
}

const after = unreadyTestBuilds(root);
if (after.length > 0) throw testBuildPrerequisiteError(after);
