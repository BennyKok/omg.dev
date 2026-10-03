import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("desktop isolates foreign CDP, reuses/adopts its browser, serializes starts and cleans cancellation/failure", async () => {
  const base = join(process.env.HOME ?? ".", ".cache", "lfg", "tmp");
  mkdirSync(base, { recursive: true });
  const home = mkdtempSync(join(base, "desktop-lifecycle-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  const fixture = join(import.meta.dir, "desktop-lifecycle.fixture.ts");
  for (const name of ["Xvfb", "startxfce4", "x11vnc", "google-chrome"]) {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' '${name}' "$@"\n`);
    chmodSync(file, 0o755);
  }
  // Keep RFB isolated too. Its owner still requires a configured free port.
  const reserve = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = reserve.port!;
  reserve.stop(true);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, OMG_COMPUTER_RFB_PORT: String(port) };
  delete env.OMG_COMPUTER_CDP_PORT;
  delete env.XDG_CONFIG_HOME;
  const proc = Bun.spawn([process.execPath, fixture, "scenario"], { env, stdout: "pipe", stderr: "pipe" });
  try {
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect({ code, err: code ? err : "" }).toEqual({ code: 0, err: "" });
    expect(JSON.parse(out)).toEqual({ isolated: true, persisted: true, reused: true, adopted: true, concurrent: true, cleanup: true });
    const calls = readFileSync(join(home, "calls"), "utf8").trim().split("\n");
    // Three starts, including the failure, produce exactly three owned browsers.
    expect(calls.filter(line => line.startsWith("google-chrome "))).toHaveLength(3);
    // The session must not start a screen locker that asks for a Linux password.
    const saver = readFileSync(join(home, ".config", "xfce4", "xfconf", "xfce-perchannel-xml", "xfce4-screensaver.xml"), "utf8");
    expect(saver).toContain('<property name="lock" type="empty">\n    <property name="enabled" type="bool" value="false"/>');
    expect(saver).toContain('<property name="idle-activation" type="empty">\n      <property name="enabled" type="bool" value="false"/>');
    expect(existsSync(join(home, ".omg", "computer", "desktop.json"))).toBe(false);
    for (const line of calls.filter(line => !line.startsWith("scenario "))) {
      expect(() => process.kill(Number(line.split(" ")[1]), 0)).toThrow();
    }
  } finally { proc.kill(); rmSync(home, { recursive: true, force: true }); }
}, 30_000);
