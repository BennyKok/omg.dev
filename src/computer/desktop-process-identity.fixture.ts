import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { desktopStatus, ensureDesktopAdopted, stopDesktop } from "./desktop.ts";

const scenario = process.argv[2]!;
const roles = ["xvfb", "wm", "vnc", "chrome"] as const;
const children: ReturnType<typeof Bun.spawn>[] = [];
const pids: Partial<Record<typeof roles[number], number>> = {};
const identities: Record<string, { bootId: string; startTime: string }> = {};
const dir = join(process.env.HOME!, ".omg", "computer");
mkdirSync(dir, { recursive: true });
const file = join(dir, "desktop.json");
// Healthy loopback endpoints must not hide a stale PID in ANY saved role.
const rfb = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("rfb") });
const cdp = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("cdp") });
const config = { display: 199, width: 1280, height: 800, rfbPort: rfb.port, cdpPort: cdp.port, profileDir: join(dir, "profile") };
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function save(): void {
  writeFileSync(file, JSON.stringify({ config, pids, startedAt: Date.now(), ...(scenario === "legacy-foreign" ? {} : { identities }) }));
}
try {
  for (const role of roles) {
    // Includes spaces and ')' in comm to exercise the Linux stat parser.
    const child = Bun.spawn([process.execPath, "-e", `require("node:fs").writeFileSync("/proc/self/comm", "foreign ) role"); console.log("ready"); setInterval(() => {}, 1000);`], { stdout: "pipe", stderr: "ignore" });
    children.push(child);
    await child.stdout.getReader().read();
    pids[role] = child.pid;
    const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8");
    identities[role] = { bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), startTime: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]! };
    if (["stale-start", "stale-stop"].includes(scenario)) identities[role]!.startTime = String(BigInt(identities[role]!.startTime) + 1n);
    if (scenario === "stale-boot") identities[role]!.bootId = "previous-boot";
  }
  if (scenario === "mixed-wm") identities.wm!.startTime = "0";
  if (scenario === "missing-identity") delete identities.wm;
  save();
  const legitimate = scenario === "adopt-stop" || scenario === "record-stop";
  if (!["record-stop", "stale-stop"].includes(scenario)) {
    await ensureDesktopAdopted();
    if (desktopStatus().running !== legitimate) throw new Error("adopted an unverified role or refused verified processes");
  }
  if (!legitimate && scenario !== "stale-stop") {
    for (const role of roles) {
      const shouldSurvive = !["mixed-wm", "missing-identity"].includes(scenario) || role === "wm";
      if (alive(pids[role]!) !== shouldSurvive) throw new Error(`unexpected ${role} survival after adoption/reap`);
    }
    // Exercise stop with no in-memory state as well as adoptOrReap.
    save();
  }
  await stopDesktop();
  for (const role of roles) {
    const shouldSurvive = !legitimate && (!["mixed-wm", "missing-identity"].includes(scenario) || role === "wm");
    if (alive(pids[role]!) !== shouldSurvive) throw new Error(`unexpected ${role} survival after stop`);
  }
  if (existsSync(file)) throw new Error("stop left the state file");
  console.log(JSON.stringify({ scenario, verified: true }));
} finally {
  for (const child of children) { child.kill(); await child.exited; }
  rfb.stop(true); cdp.stop(true);
}
