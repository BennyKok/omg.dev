import { expect, test } from "bun:test";
test("Live Activity renders in the isolated widget runtime", () => {
  const result = Bun.spawnSync(["bun", "test", "./scripts/live-activity.native-check.ts"], { cwd: "mobile", stdout: "pipe", stderr: "pipe" });
  if (result.exitCode) console.error(new TextDecoder().decode(result.stderr));
  expect(result.exitCode).toBe(0);
});
