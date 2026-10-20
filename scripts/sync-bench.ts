#!/usr/bin/env bun
/**
 * Sync bench: how fast does a Computer get a change to a connected client?
 *
 * One test for the Computer layer's sync, so a change to the server or the
 * realtime client is judged by numbers instead of by feel. It measures what a
 * person waits for:
 *
 *   cold      first /api/bootstrap, a warm one, live socket open, first status frame
 *   title     PUT a session title on one connection -> the status row on the socket
 *   transcript an agent appends a line to its transcript -> the delta on the socket
 *   resume    socket closed, one line written while away, reconnect with
 *             resumeFromSeq -> time to "resumed" and whether the line arrived
 *   idle      frames and bytes on an idle socket
 *
 * Usage:
 *   bun scripts/sync-bench.ts --spawn                 # start this checkout on a free port
 *   bun scripts/sync-bench.ts --url http://host:port  # an existing Computer
 *       (transcript and resume need --transcript-dir: the agent's project dir)
 *   options: --iterations 20  --idle-seconds 10  --json
 *
 * --spawn runs `bun run src/cli.ts serve` with a clean environment (only PATH,
 * an isolated HOME and data folder, and its own host/port), so it never shares
 * settings, data or ports with a Computer already running on the machine. Sessions are seeded as
 * Claude Code transcripts in the isolated HOME; no model is called.
 */
import { mkdirSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { OmgLiveConnection, type OmgSocket } from "../packages/client/src/index";

type Opts = { url?: string; spawn: boolean; iterations: number; idleSeconds: number; json: boolean; sdk: boolean; transcriptDir?: string; sessionId?: string };

function parseArgs(argv: string[]): Opts {
  const o: Opts = { spawn: false, iterations: 20, idleSeconds: 10, json: false, sdk: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--url") o.url = next();
    else if (a === "--spawn") o.spawn = true;
    else if (a === "--iterations") o.iterations = Number(next());
    else if (a === "--idle-seconds") o.idleSeconds = Number(next());
    else if (a === "--json") o.json = true;
    else if (a === "--sdk") o.sdk = true;
    else if (a === "--transcript-dir") o.transcriptDir = next();
    else if (a === "--session") o.sessionId = next();
    else throw new Error(`unknown option ${a}`);
  }
  if (!o.spawn && !o.url) throw new Error("pass --spawn or --url");
  return o;
}

const now = () => performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stats(samples: number[]) {
  if (!samples.length) return null;
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = (n: number) => Math.round(n * 10) / 10;
  return { n: s.length, p50: r(q(0.5)), p95: r(q(0.95)), min: r(s[0]), max: r(s[s.length - 1]) };
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => res(port));
    });
    srv.on("error", rej);
  });
}

// ── seeding ────────────────────────────────────────────────────────────────
const CWD = "/bench/project";
const PROJECT_DIR_NAME = CWD.replace(/\//g, "-");

function claudeLine(sessionId: string, role: "user" | "assistant", text: string, parent: string | null) {
  const uuid = randomUUID();
  const base = { sessionId, uuid, parentUuid: parent, cwd: CWD, timestamp: new Date().toISOString(), isSidechain: false, userType: "external", version: "bench" };
  const line = role === "user"
    ? { ...base, type: "user", message: { role: "user", content: text } }
    : { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
  return { uuid, json: JSON.stringify(line) + "\n" };
}

class Transcript {
  last: string | null = null;
  constructor(readonly path: string, readonly sessionId: string) {}
  append(role: "user" | "assistant", text: string) {
    const l = claudeLine(this.sessionId, role, text, this.last);
    appendFileSync(this.path, l.json);
    this.last = l.uuid;
  }
}

function seed(home: string, count: number): Transcript[] {
  const dir = join(home, ".claude", "projects", PROJECT_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  const out: Transcript[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const path = join(dir, `${id}.jsonl`);
    writeFileSync(path, "");
    const t = new Transcript(path, id);
    t.append("user", `bench session ${i}: hello`);
    t.append("assistant", `bench session ${i}: ready`);
    out.push(t);
  }
  return out;
}

/**
 * A live session without a model: a `sleep` process named `claude`, mapped to
 * a seeded transcript through ~/.claude/sessions/<pid>.json, which is how the
 * Computer finds the session a running Claude Code process owns.
 */
function startStandInAgent(home: string, t: Transcript): ChildProcess {
  const child = spawn("bash", ["-c", "exec -a claude sleep 86400"], { stdio: "ignore", cwd: "/" });
  const dir = join(home, ".claude", "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${child.pid}.json`), JSON.stringify({ pid: child.pid, sessionId: t.sessionId, cwd: CWD, startedAt: Date.now() }));
  return child;
}

const log = (msg: string) => process.stderr.write(`[sync-bench] ${msg}\n`);

// ── server ─────────────────────────────────────────────────────────────────
async function spawnComputer(): Promise<{ url: string; child: ChildProcess; transcripts: Transcript[]; cleanup: () => void }> {
  const root = resolve(import.meta.dir, "..");
  const base = join(process.env.HOME ?? "/root", ".cache", "lfg", "tmp", `sync-bench-${process.pid}`);
  const home = join(base, "home");
  mkdirSync(join(base, "repos"), { recursive: true });
  const transcripts = seed(home, 3);
  const agent = startStandInAgent(home, transcripts[0]);
  const port = await freePort();
  const child = spawn("bun", ["run", "src/cli.ts", "serve"], {
    cwd: root,
    // OMG_DATA_DIR too: the server's data folder defaults to <repo>/data, and
    // a bench run must not leave a model catalog or database in the checkout.
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, OMG_HOST: "127.0.0.1", OMG_PORT: String(port), OMG_REPOS_ROOT: join(base, "repos"), OMG_DATA_DIR: join(base, "data") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const t0 = now();
  while (now() - t0 < 60_000) {
    if (child.exitCode !== null) throw new Error(`serve exited ${child.exitCode}:\n${log.slice(-2000)}`);
    try {
      if ((await fetch(`${url}/api/install`)).ok) break;
    } catch {}
    await sleep(200);
  }
  return {
    url, child, transcripts,
    cleanup: () => { child.kill("SIGTERM"); agent.kill("SIGTERM"); rmSync(base, { recursive: true, force: true }); },
  };
}

// ── live socket ────────────────────────────────────────────────────────────
type Frame = { t: string; kind?: string; key?: string; seq?: number; rows?: Array<Record<string, unknown>>; [k: string]: unknown };

class Live {
  ws!: WebSocket;
  frames = 0;
  bytes = 0;
  lastSeq = new Map<string, number>();
  private lastByKey = new Map<string, Frame>();
  lastFrameFor(key: string) { return this.lastByKey.get(key) ?? null; }
  private waiters: Array<{ match: (f: Frame, raw: string) => boolean; resolve: (at: number) => void }> = [];
  openedAt = 0;
  firstStatusAt = 0;

  constructor(readonly url: string) {}

  open(): Promise<void> {
    const wsUrl = this.url.replace(/^http/, "ws") + "/api/live/ws";
    const t0 = now();
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (e) => {
      const raw = String(e.data);
      this.frames++;
      this.bytes += raw.length;
      let f: Frame;
      try { f = JSON.parse(raw); } catch { return; }
      if (typeof f.seq === "number" && f.kind && f.key) this.lastSeq.set(`${f.kind}:${f.key}`, f.seq);
      if (f.key) this.lastByKey.set(f.key, f);
      if (f.t === "status" && !this.firstStatusAt) this.firstStatusAt = now() - t0;
      const at = now();
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(f, raw)) return true;
        w.resolve(at);
        return false;
      });
    };
    return new Promise((res, rej) => {
      this.ws.onopen = () => { this.openedAt = now() - t0; res(); };
      this.ws.onerror = () => rej(new Error("live socket error"));
    });
  }

  send(msg: unknown) { this.ws.send(JSON.stringify(msg)); }

  subscribeTranscript(sid: string, resumeFromSeq?: number) {
    this.send({ t: "subscribe", channels: [{ kind: "transcript", key: sid, ...(resumeFromSeq ? { resumeFromSeq } : {}) }] });
  }

  waitFor(match: (f: Frame, raw: string) => boolean, timeoutMs = 10_000): Promise<number> {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("timed out waiting for frame")), timeoutMs);
      this.waiters.push({ match, resolve: (at) => { clearTimeout(timer); res(at); } });
    });
  }

  close(): Promise<void> {
    return new Promise((res) => {
      if (this.ws.readyState === WebSocket.CLOSED) return res();
      this.ws.onclose = () => res();
      this.ws.close();
    });
  }
}

// ── scenarios ──────────────────────────────────────────────────────────────
async function timed<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const t0 = now();
  const v = await fn();
  return [now() - t0, v];
}

/** Exercise the same SDK-backed adapter used by web and native, not only wire frames. */
async function benchSdk(url: string, transcript: Transcript, iterations: number) {
  let socket: WebSocket;
  let visible = true;
  let onVisible = () => {};
  let statusMatch: ((rows: Array<{ sessionId: string | null; title?: string | null }>) => void) | undefined;
  let transcriptMatch: ((event: unknown) => void) | undefined;
  const live = new OmgLiveConnection({
    async openLiveSocket() {
      socket = new WebSocket(url.replace(/^http/, "ws") + "/api/live/ws");
      return socket as unknown as OmgSocket;
    },
  }, {
    environment: {
      isVisible: () => visible, isOffline: () => false,
      onVisible: listener => { onVisible = listener; return () => { onVisible = () => {}; }; },
      onOnline: () => () => {},
    },
  });
  const wait = (set: (done: () => void) => void) => new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SDK client did not receive update")), 10_000);
    set(() => { clearTimeout(timer); resolve(now()); });
  });
  try {
    const status = wait(done => { statusMatch = () => done(); });
    live.subscribeStatus(rows => statusMatch?.(rows));
    const snapshot = wait(done => { transcriptMatch = event => { if ((event as { type: string }).type === "snapshot") done(); }; });
    live.subscribeTranscript(transcript.sessionId, event => transcriptMatch?.(event));
    await Promise.all([status, snapshot]);
    const titles: number[] = [], messages: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const marker = `sdk-title-${randomUUID()}`;
      const seen = wait(done => { statusMatch = rows => { if (rows.some(row => row.sessionId === transcript.sessionId && row.title === marker)) done(); }; });
      const started = now();
      const response = await fetch(`${url}/api/sessions/${transcript.sessionId}/title`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: marker }),
      });
      if (!response.ok) throw new Error(`SDK benchmark title write failed: ${response.status}`);
      titles.push((await seen) - started);
      const text = `sdk-message-${randomUUID()}`;
      const received = wait(done => { transcriptMatch = event => { if (JSON.stringify(event).includes(text)) done(); }; });
      const written = now();
      transcript.append("assistant", text);
      messages.push((await received) - written);
      await sleep(75);
    }
    visible = false;
    const closed = new Promise<void>(resolve => socket!.addEventListener("close", () => resolve(), { once: true }));
    socket!.close();
    await closed;
    const marker = `sdk-away-${randomUUID()}`;
    transcript.append("assistant", marker);
    await sleep(1500);
    const received = wait(done => { transcriptMatch = event => { if (JSON.stringify(event).includes(marker)) done(); }; });
    const started = now();
    visible = true;
    onVisible();
    const resumeMs = (await received) - started;
    return { titleToStatusMs: stats(titles), transcriptAppendToClientMs: stats(messages), missedLineArrivedMs: Math.round(resumeMs) };
  } finally { live.dispose(); }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let url = o.url!;
  let transcripts: Transcript[] = [];
  let cleanup = () => {};
  let spawnMs: number | null = null;
  if (o.spawn) {
    const t0 = now();
    const s = await spawnComputer();
    spawnMs = now() - t0;
    url = s.url; transcripts = s.transcripts; cleanup = s.cleanup;
  } else if (o.transcriptDir && o.sessionId) {
    transcripts = [new Transcript(join(o.transcriptDir, `${o.sessionId}.jsonl`), o.sessionId)];
  }
  const result: Record<string, unknown> = { url, spawnMs: spawnMs && Math.round(spawnMs) };
  try {
    // cold
    const [bootstrapFirst, b1] = await timed(() => fetch(`${url}/api/bootstrap`));
    const body = await b1.text();
    const [bootstrapWarm] = await timed(async () => (await fetch(`${url}/api/bootstrap`)).text());
    const live = new Live(url);
    await live.open();
    await live.waitFor((f) => f.t === "status", 15_000).catch(() => 0);
    result.cold = {
      serverTiming: b1.headers.get("server-timing"),
      bootstrapFirstMs: Math.round(bootstrapFirst), bootstrapWarmMs: Math.round(bootstrapWarm), bootstrapBytes: body.length,
      socketOpenMs: Math.round(live.openedAt), firstStatusMs: Math.round(live.firstStatusAt),
    };

    log(`cold ${JSON.stringify(result.cold)}`);
    // title -> status row
    const sid = o.sessionId ?? transcripts[0]?.sessionId;
    if (!sid) throw new Error("no session to rename; pass --session with a live session you own");
    // The live session must be in the server's list before its title can move.
    const listT0 = now();
    while (!((await (await fetch(`${url}/api/sessions`)).json()) as { sessions: Array<{ sessionId: string | null }> }).sessions.some((x) => x.sessionId === sid)) {
      if (now() - listT0 > 20_000) throw new Error(`session ${sid} never appeared in /api/sessions`);
      await sleep(250);
    }
    result.liveSessionListedMs = Math.round(now() - listT0);
    log(`session listed after ${result.liveSessionListedMs} ms`);
    const title: number[] = [];
    for (let i = 0; i < o.iterations; i++) {
      const want = `bench-title-${i}-${randomUUID().slice(0, 6)}`;
      const seen = live.waitFor((f) => f.t === "status" && !!f.rows?.some((r) => r.sessionId === sid && r.title === want));
      const t0 = now();
      const res = await fetch(`${url}/api/sessions/${sid}/title`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: want }) });
      if (!res.ok) throw new Error(`title PUT ${res.status}: ${await res.text()}`);
      title.push((await seen) - t0);
      await sleep(50 + Math.random() * 150);
    }
    result.titleToStatusMs = stats(title);
    log(`title ${JSON.stringify(result.titleToStatusMs)}`);

    // transcript append -> delta
    if (transcripts[0]) {
      const t = transcripts[0];
      live.subscribeTranscript(t.sessionId);
      await live.waitFor((f) => f.t === "snapshot" && f.key === t.sessionId, 15_000).catch(() => 0);
      const tr: number[] = [];
      for (let i = 0; i < o.iterations; i++) {
        const marker = `bench-msg-${i}-${randomUUID().slice(0, 8)}`;
        const seen = live.waitFor((f, raw) => f.key === t.sessionId && raw.includes(marker));
        const t0 = now();
        t.append("assistant", marker);
        tr.push((await seen) - t0);
        await sleep(50 + Math.random() * 150);
      }
      result.transcriptAppendToDeltaMs = stats(tr);
      log(`transcript ${JSON.stringify(result.transcriptAppendToDeltaMs)}`);

      // resume after a drop
      const ch = `transcript:${t.sessionId}`;
      const fromSeq = live.lastSeq.get(ch);
      await live.close();
      const marker = `bench-away-${randomUUID().slice(0, 8)}`;
      t.append("assistant", marker);
      await sleep(1500); // the server must notice the line while no one listens
      const again = new Live(url);
      const t0 = now();
      await again.open();
      const gotMissed = again.waitFor((f, raw) => f.key === t.sessionId && raw.includes(marker), 10_000).then((at) => at - t0, () => null);
      const resumed = again.waitFor((f) => f.key === t.sessionId && (f.t === "resumed" || f.t === "gap" || f.t === "snapshot"), 10_000).then((at) => at - t0, () => null);
      const firstFrame = again.waitFor((f) => f.key === t.sessionId, 10_000).then(() => again.lastFrameFor(t.sessionId), () => null);
      again.subscribeTranscript(t.sessionId, fromSeq);
      const [missedMs, resumeMs, first] = await Promise.all([gotMissed, resumed, firstFrame]);
      result.resume = {
        fromSeq,
        firstFrame: first ? { t: first.t, seq: first.seq, replayed: first.replayed, messages: Array.isArray(first.messages) ? first.messages.length : undefined } : null,
        reconnectToFirstFrameMs: resumeMs && Math.round(resumeMs),
        missedLineArrivedMs: missedMs && Math.round(missedMs),
      };

      // idle traffic
      const f0 = again.frames, b0 = again.bytes;
      await sleep(o.idleSeconds * 1000);
      result.idle = { seconds: o.idleSeconds, frames: again.frames - f0, bytes: again.bytes - b0 };
      await again.close();
      if (o.sdk) {
        result.sdkClient = await benchSdk(url, t, o.iterations);
        log(`SDK client ${JSON.stringify(result.sdkClient)}`);
      }
    } else {
      await live.close();
    }
  } finally {
    cleanup();
  }
  if (o.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const [k, v] of Object.entries(result)) console.log(`${k.padEnd(28)} ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
