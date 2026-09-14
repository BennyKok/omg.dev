import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("mobile tray lifecycle and page navigation", () => {
  // Isolate native mocks from the rest of the server and web test process.
  const result = Bun.spawnSync(["bun", "test", "./mobile/scripts/sheet.native-check.tsx"], {
    cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  expect(result.exitCode).toBe(0);
});
