import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findOrphanOpencodeServers, reapOrphanOpencodeServers } from "./orphan-agent-servers.ts";

let proc = "";
beforeEach(() => { proc = mkdtempSync(join(tmpdir(), "lfg-fake-proc-")); });
afterEach(() => rmSync(proc, { recursive: true, force: true }));

const OMG_ENV = 'OPENCODE_CONFIG_CONTENT={"mcp":{"omg":{"headers":{"x-omg-session-token":"t"}}}}';
function fake(pid: number, ppid: number, argv: string[], env: string[] = []) {
  const dir = join(proc, String(pid));
  mkdirSync(dir);
  writeFileSync(join(dir, "cmdline"), argv.join("\0") + "\0");
  writeFileSync(join(dir, "environ"), env.join("\0") + "\0");
  writeFileSync(join(dir, "stat"), `${pid} (${argv[0]?.split("/").pop()} x) S ${ppid} 1 1 0`);
}
const SERVE = ["opencode", "serve", "--hostname=127.0.0.1", "--port=0"];

test("finds only our opencode servers whose harness is gone", () => {
  fake(1506, 1, ["/usr/lib/systemd/systemd", "--user"]);
  fake(200, 1, ["/home/dev/.bun/bin/bun", "/x/src/agents/backends/opencode-aisdk-session.ts", "--key", "k"]);
  fake(201, 200, SERVE, [OMG_ENV]);           // live harness: keep
  fake(300, 1506, SERVE, [OMG_ENV]);          // orphan: stop
  fake(301, 1506, ["/usr/local/bin/opencode", ...SERVE.slice(1)], [OMG_ENV]); // orphan by full path: stop
  fake(400, 1506, SERVE, ["PATH=/bin"]);      // a person's server: keep
  fake(500, 1506, ["opencode", "serve", "--port=4096"], [OMG_ENV]); // other argv: keep
  fake(600, 1506, ["bash"]);
  expect(findOrphanOpencodeServers(proc).sort()).toEqual([300, 301]);
});

test("sends SIGTERM to each orphan and reports it", () => {
  fake(1506, 1, ["systemd"]);
  fake(300, 1506, SERVE, [OMG_ENV]);
  const sent: Array<[number, string]> = [];
  expect(reapOrphanOpencodeServers(proc, (pid, signal) => sent.push([pid, signal]))).toEqual([300]);
  expect(sent).toEqual([[300, "SIGTERM"]]);
});

test("a missing proc root finds nothing", () => {
  expect(findOrphanOpencodeServers(join(proc, "absent"))).toEqual([]);
});
