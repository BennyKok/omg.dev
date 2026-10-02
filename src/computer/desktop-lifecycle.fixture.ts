// Subprocess fixture: fake native desktop programs, real loopback sockets and
// persisted state. No X display or installed Chrome is required by these tests.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const role = process.argv[2];
const root = process.env.HOME!;
appendFileSync(join(root, "calls"), `${role} ${process.pid}\n`);
if (role === "google-chrome") {
  if (process.env.FAIL_CHROME) process.exit(1);
  // Like a Firecracker guest with no /dev/shm: real Chrome aborts at start
  // unless it is told to keep shared memory elsewhere.
  if (!process.argv.includes("--disable-dev-shm-usage")) process.exit(134);
  const profile = process.argv.find(a => a.startsWith("--user-data-dir="))!.split("=")[1]!;
  const requested = Number(process.argv.find(a => a.startsWith("--remote-debugging-port="))!.split("=")[1]);
  let endpointPort = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: requested, fetch: () => Response.json({ webSocketDebuggerUrl: `ws://127.0.0.1:${endpointPort}/devtools/browser/owned` }) });
  endpointPort = server.port!;
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, "DevToolsActivePort"), `${server.port}\n/devtools/browser/owned`);
} else if (role === "x11vnc") {
  Bun.serve({ hostname: "127.0.0.1", port: Number(process.argv[process.argv.indexOf("-rfbport") + 1]), fetch: () => new Response("RFB fixture") });
} else if (role === "scenario") {
  const { startDesktop, stopDesktop, desktopStatus, cdpWebSocketUrl } = await import("./desktop.ts");
  const occupied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("unrelated browser") });
  const profile = join(root, ".omg", "computer", "chrome-profile");
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, "DevToolsActivePort"), `${occupied.port}\n/devtools/browser/stale`);
  try {
    // An explicit occupied port still refuses to attach to an unrelated browser.
    let conflict = "";
    try { await startDesktop({ cdpPort: occupied.port }); } catch (e) { conflict = String(e); }
    if (!conflict.includes("cannot open its browser")) throw new Error("did not refuse explicit foreign endpoint");
    const [a, b, c] = await Promise.all([startDesktop(), startDesktop(), startDesktop()]);
    if (!a.running || a.cdpPort !== b.cdpPort || b.cdpPort !== c.cdpPort || a.cdpPort === occupied.port || !a.cdpPort) throw new Error("concurrent startup did not share an isolated browser");
    const record = JSON.parse(readFileSync(join(root, ".omg", "computer", "desktop.json"), "utf8"));
    if (record.config.cdpPort !== a.cdpPort) throw new Error("assigned port not persisted");
    const reused = await startDesktop({ cdpPort: occupied.port });
    if (reused.startedAt !== a.startedAt || reused.cdpPort !== a.cdpPort) throw new Error("healthy browser not reused");
    if (!(await cdpWebSocketUrl())?.endsWith("/devtools/browser/owned")) throw new Error("attached to foreign browser");
    // A restarted runtime adopts exactly this persisted browser.
    const adopter = Bun.spawn([process.execPath, "-e", `import {startDesktop} from ${JSON.stringify(join(import.meta.dir, "desktop.ts"))}; const s=await startDesktop(); console.log(s.cdpPort); process.exit(0);`], { env: process.env, stdout: "pipe", stderr: "pipe" });
    const adopted = await new Response(adopter.stdout).text();
    if (await adopter.exited !== 0 || Number(adopted.trim()) !== a.cdpPort) throw new Error("existing browser adoption failed");
    await stopDesktop();
    if (desktopStatus().running) throw new Error("stop left state running");
    // Stop arriving during startup runs after startup, and cleans its children.
    const starting = startDesktop();
    const stopping = stopDesktop();
    await starting; await stopping;
    if (desktopStatus().running) throw new Error("late startup survived stop");
    // Failure also reaps every native child, then leaves a working retry path.
    process.env.FAIL_CHROME = "1";
    let failed = false;
    try { await startDesktop(); } catch { failed = true; }
    delete process.env.FAIL_CHROME;
    if (!failed || desktopStatus().running) throw new Error("failed startup left a desktop");
    if ((await (await fetch(`http://127.0.0.1:${occupied.port}`)).text()) !== "unrelated browser") throw new Error("foreign browser was stopped");
    console.log(JSON.stringify({ isolated: true, persisted: true, reused: true, adopted: true, concurrent: true, cleanup: true }));
  } finally { await stopDesktop(); occupied.stop(true); }
  process.exit(0);
}
setInterval(() => {}, 1000);
