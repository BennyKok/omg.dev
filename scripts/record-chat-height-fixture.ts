#!/usr/bin/env bun
/**
 * Record the chat row height fixture.
 *
 * The gate this feeds (web/src/lib/chat-row-height.fixture.test.ts) compares
 * the pure height model against heights a real browser really laid out, over
 * real transcript bubbles. That comparison needs a browser once; it must not
 * need one on every test run. So this script records, and the test replays.
 *
 * What it does:
 *   1. pulls assistant markdown out of a real agent transcript on disk,
 *   2. compiles the app stylesheet with the Tailwind CLI (not a vite build —
 *      about 300 ms and 240 kB, against 1.7 GB peak for the bundle),
 *   3. bundles scripts/chat-height-fixture/harness.tsx with `bun build`,
 *   4. serves both on 127.0.0.1 and renders them in the cached Chromium that
 *      already ships with this machine's Playwright install, driven over the
 *      DevTools protocol so no extra dependency is needed,
 *   5. writes the measured heights, the probed CSS metrics and every pretext
 *      measurement into the fixture.
 *
 * Usage:
 *   bun run scripts/record-chat-height-fixture.ts [--transcript=PATH] [--count=N]
 */

import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE_PATH = join(REPO, "web/src/lib/chat-row-height.fixture.json");
const DEFAULT_COUNT = 120;

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

type Sample = { id: string; text: string };

async function biggestTranscript(): Promise<string> {
  const root = join(homedir(), ".claude/projects");
  const projects = await readdir(root).catch(() => [] as string[]);
  let best: { path: string; size: number } | null = null;
  for (const project of projects) {
    const dir = join(root, project);
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const path = join(dir, entry);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) continue;
      if (!best || info.size > best.size) best = { path, size: info.size };
    }
  }
  if (!best) throw new Error("no transcript found under ~/.claude/projects");
  return best.path;
}

/** Assistant prose, in the order it was written, deduplicated. */
async function collectSamples(transcript: string, count: number): Promise<Sample[]> {
  const raw = await readFile(transcript, "utf8");
  const seen = new Set<string>();
  const samples: Sample[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = parsed as {
      type?: string;
      uuid?: string;
      message?: { role?: string; content?: unknown };
    };
    if (entry.type !== "assistant" || entry.message?.role !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const block = part as { type?: string; text?: string };
      if (block.type !== "text") continue;
      const text = (block.text ?? "").trim();
      if (text.length < 8) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      samples.push({ id: `${entry.uuid ?? samples.length}-${samples.length}`, text });
    }
  }
  if (!samples.length) throw new Error(`no assistant prose in ${transcript}`);
  // Spread the pick across the whole session rather than taking the first N,
  // which would be all short openers.
  const step = Math.max(1, Math.floor(samples.length / count));
  const picked: Sample[] = [];
  for (let i = 0; i < samples.length && picked.length < count; i += step) picked.push(samples[i]);
  return picked;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function run(command: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${command.join(" ")} failed (${code})\n${stderr}`);
  }
}

async function buildHarness(outDir: string): Promise<void> {
  await run(
    ["bun", "x", "@tailwindcss/cli@4", "-i", "src/index.css", "-o", join(outDir, "app.css")],
    join(REPO, "web"),
  );
  // Built from inside web/ so the app's own dependency graph and the `@/`
  // path alias resolve exactly as they do for the real bundle.
  await run(
    [
      "bun",
      "build",
      "scripts/chat-height-harness.tsx",
      "--outfile",
      join(outDir, "harness.js"),
      "--target",
      "browser",
      "--format",
      "esm",
      "--define",
      "process.env.NODE_ENV:'production'",
    ],
    join(REPO, "web"),
  );
}

// ---------------------------------------------------------------------------
// Chromium over the DevTools protocol
// ---------------------------------------------------------------------------

function findChromium(): string {
  const root = join(homedir(), ".cache/ms-playwright");
  const candidates = [
    "chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
    "chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell",
    "chromium-1228/chrome-linux64/chrome",
    "chromium-1234/chrome-linux64/chrome",
  ];
  for (const candidate of candidates) {
    const path = join(root, candidate);
    if (existsSync(path)) return path;
  }
  throw new Error(`no cached Chromium under ${root}`);
}

async function waitForPort(profile: string): Promise<number> {
  const path = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 200; i += 1) {
    const body = await readFile(path, "utf8").catch(() => null);
    const port = body ? parseInt(body.split("\n")[0], 10) : NaN;
    if (Number.isFinite(port)) return port;
    await Bun.sleep(100);
  }
  throw new Error("Chromium never reported a DevTools port");
}

type Cdp = {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
};

async function connect(url: string): Promise<Cdp> {
  const socket = new WebSocket(url);
  await new Promise<void>((ok, fail) => {
    socket.onopen = () => ok();
    socket.onerror = () => fail(new Error(`cannot open ${url}`));
  });
  let nextId = 1;
  const pending = new Map<number, { ok: (v: Record<string, unknown>) => void; fail: (e: Error) => void }>();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (message.id == null) return;
    const slot = pending.get(message.id);
    if (!slot) return;
    pending.delete(message.id);
    if (message.error) slot.fail(new Error(message.error.message ?? "CDP error"));
    else slot.ok(message.result ?? {});
  };
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((ok, fail) => {
        pending.set(id, { ok, fail });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(cdp: Cdp, expression: string): Promise<unknown> {
  const result = (await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })) as {
    result?: { value?: unknown };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "eval failed",
    );
  }
  return result.result?.value;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = new Map(
    process.argv.slice(2).map((arg) => {
      const [key, value = "1"] = arg.replace(/^--/, "").split("=");
      return [key, value] as const;
    }),
  );
  const count = parseInt(args.get("count") ?? String(DEFAULT_COUNT), 10) || DEFAULT_COUNT;
  const transcript = args.get("transcript") ?? (await biggestTranscript());
  console.log(`transcript: ${transcript}`);

  const samples = await collectSamples(transcript, count);
  console.log(`samples: ${samples.length}`);

  const outDir = await mkdtemp(join(tmpdir(), "omg-chat-height-"));
  const profile = join(outDir, "profile");
  let browser: ChildProcess | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;
  try {
    await buildHarness(outDir);
    await writeFile(join(outDir, "samples.json"), JSON.stringify(samples));
    await writeFile(
      join(outDir, "index.html"),
      `<!doctype html><html class="light"><head><meta charset="utf-8">` +
        `<link rel="stylesheet" href="/app.css">` +
        // Streamdown puts `content-visibility: auto` with a 200px intrinsic
        // size on a code fence card, so a fence below the fold reports the
        // placeholder height instead of its own. The model predicts the height
        // a fence settles at once it is on screen, which is the only height
        // the virtualizer ever measures, so force real layout here.
        `<style>[data-streamdown="code-block"]{content-visibility:visible !important;}</style>` +
        `</head>` +
        `<body><script type="module" src="/harness.js"></script></body></html>`,
    );

    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        const file = Bun.file(join(outDir, path === "/" ? "index.html" : path.slice(1)));
        return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
      },
    });
    const pageUrl = `http://127.0.0.1:${server.port}/`;
    console.log(`serving ${pageUrl}`);

    browser = spawn(
      findChromium(),
      [
        "--headless",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--force-device-scale-factor=1",
        "--window-size=1400,1200",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );

    const port = await waitForPort(profile);
    const target = (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pageUrl)}`, {
      method: "PUT",
    }).then((response) => response.json())) as { webSocketDebuggerUrl?: string };
    if (!target.webSocketDebuggerUrl) throw new Error("Chromium opened no page target");
    const cdp = await connect(target.webSocketDebuggerUrl);

    // Poll from out here rather than awaiting a promise inside the page: the
    // target starts navigating the moment it is created, and any evaluate that
    // is in flight when the document commits dies with its execution context.
    let fixture: unknown = null;
    const deadline = Date.now() + 180_000;
    while (!fixture) {
      if (Date.now() > deadline) throw new Error("harness timed out");
      const state = (await evaluate(
        cdp,
        `(() => {
           if (window.__CHAT_HEIGHT_ERROR__) return { error: window.__CHAT_HEIGHT_ERROR__ };
           if (window.__CHAT_HEIGHT_FIXTURE__) return { fixture: window.__CHAT_HEIGHT_FIXTURE__ };
           return {};
         })()`,
      ).catch(() => null)) as { error?: string; fixture?: unknown } | null;
      if (state?.error) throw new Error(state.error);
      if (state?.fixture) fixture = state.fixture;
      else await Bun.sleep(250);
    }
    cdp.close();

    await writeFile(FIXTURE_PATH, `${JSON.stringify(fixture, null, 0)}\n`);
    const rows = (fixture as { rows: { domHeight: number; modelHeight: number }[] }).rows;
    const errors = rows.map((row) => Math.abs(row.domHeight - row.modelHeight));
    errors.sort((a, b) => a - b);
    console.log(
      `rows ${rows.length} | median ${errors[Math.floor(errors.length / 2)].toFixed(2)}px | ` +
        `p99 ${errors[Math.floor(errors.length * 0.99)].toFixed(2)}px | max ${errors[errors.length - 1].toFixed(2)}px`,
    );
    console.log(`wrote ${FIXTURE_PATH}`);
  } finally {
    browser?.kill("SIGKILL");
    server?.stop(true);
    await rm(outDir, { recursive: true, force: true });
  }
}

await main();
