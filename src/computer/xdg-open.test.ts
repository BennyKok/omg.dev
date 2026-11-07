import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installXdgOpenShim, XDG_OPEN_SHIM_DIR } from "./xdg-open.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omg-xdg-open-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("xdg-open shim", () => {
  test("goes on PATH only when the system has none", () => {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const env: NodeJS.ProcessEnv = { PATH: bin };
    expect(installXdgOpenShim(env, 9000)).toBe(true);
    expect(env.PATH!.split(":")[0]).toBe(XDG_OPEN_SHIM_DIR);
    expect(env.OMG_COMPUTER_API).toBe("http://127.0.0.1:9000");

    writeFileSync(join(bin, "xdg-open"), "#!/bin/sh\n");
    chmodSync(join(bin, "xdg-open"), 0o755);
    const own: NodeJS.ProcessEnv = { PATH: bin };
    expect(installXdgOpenShim(own)).toBe(false);
    expect(own.PATH).toBe(bin);
  });

  test("opens the URL through serve and never fails its caller", async () => {
    const seen: { path: string; body: string }[] = [];
    const server = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      async fetch(req) { seen.push({ path: new URL(req.url).pathname, body: await req.text() }); return Response.json({ ok: true }); },
    });
    const url = "https://github.com/login/device";
    try {
      // Async spawn: the fake serve runs on this same event loop.
      const ok = Bun.spawn([join(XDG_OPEN_SHIM_DIR, "xdg-open"), url], { env: { PATH: process.env.PATH, OMG_COMPUTER_API: `http://127.0.0.1:${server.port}` }, stderr: "pipe" });
      expect(await ok.exited).toBe(0);
      expect(seen.map((s) => s.path)).toEqual(["/api/computer/start", "/api/computer/browser/navigate"]);
      expect(JSON.parse(seen[1]!.body)).toEqual({ url, kiosk: false });
    } finally { server.stop(true); }
    const down = Bun.spawnSync([join(XDG_OPEN_SHIM_DIR, "xdg-open"), url], { env: { PATH: process.env.PATH, OMG_COMPUTER_API: "http://127.0.0.1:1" } });
    expect(down.exitCode).toBe(0);
    expect(new TextDecoder().decode(down.stderr)).toContain(url);
  });
});
