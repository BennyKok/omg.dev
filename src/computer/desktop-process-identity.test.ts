import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

// Each worker has an isolated HOME and module singleton. These are real OS
// processes and sockets, not mocks of kill(), /proc, or the desktop lifecycle.
for (const scenario of ["stale-start", "stale-stop", "stale-boot", "legacy-foreign", "mixed-wm", "missing-identity", "adopt-stop", "record-stop"]) {
  test(`desktop process identity: ${scenario}`, async () => {
    const base = join(process.env.HOME ?? ".", ".cache", "lfg", "tmp");
    mkdirSync(base, { recursive: true });
    const home = mkdtempSync(join(base, "desktop-identity-"));
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "desktop-process-identity.fixture.ts"), scenario], {
      env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe",
    });
    try {
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect({ code, err: code ? err : "" }).toEqual({ code: 0, err: "" });
      expect(JSON.parse(out)).toEqual({ scenario, verified: true });
    } finally {
      proc.kill();
      rmSync(home, { recursive: true, force: true });
    }
  }, 10_000);
}
