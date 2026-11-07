// voxl: the faster stream of the Computer's screen, and the default one.
//
// voxl (https://github.com/tembo/voxl, MIT; links x264, GPL-2.0) captures
// the X display and sends it as H.264 stripes over one websocket, which the
// browser decodes with WebCodecs. It is on by default wherever the binary is
// installed. Without it the stream is x11vnc -> RfbBridge -> noVNC (see
// rfb-bridge.ts), and a browser that cannot decode voxl uses noVNC too.
//
//   OMG_COMPUTER_STREAM=vnc    opt this box out of voxl
//   OMG_VOXL_BIN=/path/voxl    the binary (default: `voxl` on PATH, then
//                              ~/.cargo/bin/voxl)
//   OMG_COMPUTER_VOXL_PORT     its loopback port (default 6901)
//
// x11vnc keeps running beside it, so agents are unaffected and opting out
// needs nothing but a restart.
//
// Security: voxl listens on 127.0.0.1 only, with a random password that never
// leaves this process and the 0600 record below. The browser reaches it only
// through serve's authenticated /api/computer/voxl socket, which adds the
// password itself. voxl's file panel, audio and resize are off: the Files
// panel would otherwise expose all of $HOME to anyone holding the stream.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { computerDir } from "./desktop.ts";

export type ComputerStream = "vnc" | "voxl";

export interface VoxlEndpoint {
  port: number;
  password: string;
}

interface VoxlRecord extends VoxlEndpoint {
  pid: number;
  display: number;
}

function onPath(bin: string, path: string | undefined): string | null {
  for (const dir of (path ?? "").split(":")) {
    if (dir && existsSync(join(dir, bin))) return join(dir, bin);
  }
  return null;
}

export function voxlBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.OMG_VOXL_BIN?.trim();
  if (explicit) return existsSync(explicit) ? explicit : null;
  const cargo = join(env.HOME ?? "/nonexistent", ".cargo", "bin", "voxl");
  return onPath("voxl", env.PATH) ?? (existsSync(cargo) ? cargo : null);
}

/**
 * Which stream the Computer page should use: voxl whenever its binary is
 * installed, unless the box opts out with OMG_COMPUTER_STREAM=vnc.
 */
export function computerStream(env: NodeJS.ProcessEnv = process.env): ComputerStream {
  if (env.OMG_COMPUTER_STREAM?.trim().toLowerCase() === "vnc") return "vnc";
  return voxlBinary(env) ? "voxl" : "vnc";
}

export function voxlPort(env: NodeJS.ProcessEnv = process.env): number {
  const port = Number(env.OMG_COMPUTER_VOXL_PORT ?? 6901);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 6901;
}

const recordFile = () => join(computerDir(), "voxl.json");

function readRecord(): VoxlRecord | null {
  try {
    const r = JSON.parse(readFileSync(recordFile(), "utf8")) as Partial<VoxlRecord>;
    if (typeof r.pid === "number" && typeof r.port === "number" && typeof r.password === "string" && typeof r.display === "number") {
      return r as VoxlRecord;
    }
  } catch {}
  return null;
}

/** True only for a live voxl process started with this port. Never trusts a bare pid. */
function isOurVoxl(record: VoxlRecord): boolean {
  try {
    process.kill(record.pid, 0);
    const args = readFileSync(`/proc/${record.pid}/cmdline`, "utf8").split("\0");
    return /(^|\/)voxl$/.test(args[0] ?? "") && args.includes(`--port=${record.port}`);
  } catch {
    return false;
  }
}

async function healthy(endpoint: VoxlEndpoint): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${endpoint.port}/healthz`, {
      headers: { authorization: `Bearer ${endpoint.password}` },
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function kill(record: VoxlRecord | null): void {
  if (record && isOurVoxl(record)) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch {}
  }
}

let pending: Promise<VoxlEndpoint> | null = null;

/**
 * The running voxl for `display`, started if needed. A voxl left by a previous
 * serve (restarts keep children alive) is reused when it is verifiably ours.
 */
export function ensureVoxl(display: number): Promise<VoxlEndpoint> {
  pending ??= start(display).finally(() => {
    pending = null;
  });
  return pending;
}

async function start(display: number): Promise<VoxlEndpoint> {
  const bin = voxlBinary();
  if (!bin) throw new Error("voxl is not installed");
  const port = voxlPort();
  const existing = readRecord();
  if (existing && existing.port === port && existing.display === display && isOurVoxl(existing) && (await healthy(existing))) {
    return { port: existing.port, password: existing.password };
  }
  kill(existing);

  const password = randomBytes(24).toString("base64url");
  const child = spawn(
    bin,
    [
      "--addr=127.0.0.1",
      `--port=${port}`,
      "--title=omg Computer",
      "--file-transfers=none",
      "--audio-enabled=false",
      "--microphone-enabled=false",
      "--enable-resize=false",
    ],
    {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/", DISPLAY: `:${display}`, VOXL_PASSWORD: password },
      stdio: "ignore",
      detached: true,
    },
  );
  child.unref();
  if (!child.pid) throw new Error("voxl did not start");
  const record: VoxlRecord = { pid: child.pid, port, display, password };
  writeFileSync(recordFile(), JSON.stringify(record), { mode: 0o600 });

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await healthy(record)) return { port, password };
    if (child.exitCode !== null) break;
    await Bun.sleep(150);
  }
  kill(record);
  rmSync(recordFile(), { force: true });
  throw new Error(`voxl did not come up on 127.0.0.1:${port}`);
}

/** Stop voxl with the desktop. Only a verified voxl of ours is signalled. */
export function stopVoxl(): void {
  kill(readRecord());
  rmSync(recordFile(), { force: true });
}
