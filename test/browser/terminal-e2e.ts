// End-to-end test of the browser terminal, in a real browser, against a real
// shell, with nothing mocked:
//
//   Chromium ─ Vite dev (web/e2e/terminal.html: the real dock + panel +
//   ghostty-web) ─ /api proxy ─ terminal-harness.ts (src/term/routes.ts, as
//   serve mounts it) ─ unix socket ─ terminal host process ─ PTY ─ bash
//
//   bun test/browser/terminal-e2e.ts
//
// Needs Playwright and a Chromium. PLAYWRIGHT_MODULE points at the module
// (default: the `playwright` package resolvable from $HOME), and
// CHROMIUM_EXECUTABLE at a browser binary if Playwright's own is missing.
// Everything it starts binds to 127.0.0.1 and is stopped at the end; the
// shells' HOME is a scratch directory under ~/.cache/lfg/tmp.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pingTermHost } from "../../src/term/client.ts";

const ROOT = resolve(import.meta.dir, "../..");
const scratchBase = join(homedir(), ".cache", "lfg", "tmp");
mkdirSync(scratchBase, { recursive: true });
const work = mkdtempSync(join(scratchBase, "term-e2e-"));
const sock = join(work, "run", "host.sock");
const hostOpts = { path: sock };

const children: ChildProcess[] = [];
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

async function freePort(): Promise<number> {
  const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = s.port;
  s.stop(true);
  return port;
}

function start(cmd: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; ready: RegExp; name: string }) {
  return new Promise<ChildProcess>((resolvePromise, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let out = "";
    const timer = setTimeout(() => reject(new Error(`${opts.name} did not start:\n${out}`)), 60_000);
    const onData = (d: Buffer) => {
      out += d.toString();
      if (opts.ready.test(out)) {
        clearTimeout(timer);
        resolvePromise(child);
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!opts.ready.test(out)) reject(new Error(`${opts.name} exited (${code}):\n${out}`));
    });
  });
}

const harnessPort = await freePort();
const vitePort = await freePort();
const harnessEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: work,
  LANG: "C.UTF-8",
  LFG_TERM_HOST_SOCKET: sock,
  LFG_TERM_SHELL: "/bin/bash",
  LFG_TERM_HOST_IDLE_MS: "120000",
};
const startHarness = () =>
  start(["bun", join(ROOT, "test/browser/terminal-harness.ts"), String(harnessPort), work], {
    cwd: ROOT,
    env: harnessEnv,
    ready: /harness listening/,
    name: "harness",
  });

// E2E_ONLY=<regex> runs only the matching checks (plus the first, which opens
// the dock). Handy while working on one behaviour.
const only = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY) : null;

async function check(name: string, fn: () => Promise<void>) {
  if (only && results.length > 0 && !only.test(name)) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, detail });
    console.log(`  ✗ ${name}\n      ${detail.split("\n").join("\n      ")}`);
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

let exitCode = 1;
try {
  let harness = await startHarness();
  await start(["bun", "--bun", "vite", "--port", String(vitePort), "--strictPort", "--host", "127.0.0.1"], {
    cwd: join(ROOT, "web"),
    env: { ...process.env, LFG_API_TARGET: `http://127.0.0.1:${harnessPort}` },
    ready: /Local:|ready in/,
    name: "vite",
  });

  const pwPath = process.env.PLAYWRIGHT_MODULE || join(homedir(), "node_modules", "playwright", "index.js");
  const { chromium } = await import(pwPath);
  const executablePath =
    process.env.CHROMIUM_EXECUTABLE || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    // evil.test is "another website" for the cross-site check. It resolves
    // to loopback so Chrome's own local-network block does not decide the
    // outcome before the server's check is reached.
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--host-resolver-rules=MAP evil.test 127.0.0.1"],
  });
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  // Vite's own HMR client cannot connect here (web/vite.config.ts pins its
  // socket to port 443 for the tailnet proxy) and reports that as an uncaught
  // error. It is not terminal code; every other page error fails the run.
  const onPageError = (e: Error) => {
    if (!/WebSocket closed without opened/.test(e.message)) pageErrors.push(e.message);
  };
  page.on("pageerror", onPageError);
  const base = `http://127.0.0.1:${vitePort}/e2e/terminal.html`;

  // ---- page helpers ----
  const screen = (): Promise<string> =>
    page.evaluate(() => {
      const host = document.querySelector('[data-testid="terminal-canvas-host"]') as
        | (HTMLElement & { __lfgTerminal?: { buffer: { active: { length: number; getLine(i: number): { translateToString(t: boolean): string } | undefined } } } })
        | null;
      const b = host?.__lfgTerminal?.buffer.active;
      if (!b) return "";
      const out: string[] = [];
      for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? "");
      return out.join("\n");
    });
  const waitScreen = async (needle: string | RegExp, ms = 8000) => {
    const end = Date.now() + ms;
    let last = "";
    while (Date.now() < end) {
      last = await screen();
      if (typeof needle === "string" ? last.includes(needle) : needle.test(last)) return last;
      await page.waitForTimeout(40);
    }
    throw new Error(`screen never showed ${needle}; it shows:\n${last.trim().split("\n").slice(-12).join("\n")}`);
  };
  // The shell is ready once a prompt ending in "$ " is on screen.
  const PROMPT = /\$\s*$/m;
  const status = () => page.getAttribute("[data-terminal-status]", "data-terminal-status");
  const waitStatus = async (want: string, ms = 10_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if ((await status()) === want) return;
      await page.waitForTimeout(40);
    }
    throw new Error(`status never became ${want} (is ${await status()})`);
  };
  const typeLine = async (line: string) => {
    await page.click('[data-testid="terminal-canvas-host"]');
    await page.keyboard.type(line);
    await page.keyboard.press("Enter");
  };
  const box = async (sel: string) => {
    const b = await page.locator(sel).first().boundingBox();
    assert(b, `${sel} has no box`);
    return b;
  };
  const sttySize = async () => {
    const marker = `SZ${Math.random().toString(36).slice(2, 7)}`;
    await typeLine(`echo ${marker} $(stty size)`);
    const text = await waitScreen(new RegExp(`${marker} \\d+ \\d+`));
    const m = text.match(new RegExp(`${marker} (\\d+) (\\d+)`))!;
    return { rows: Number(m[1]), cols: Number(m[2]) };
  };

  console.log("terminal e2e");
  await page.goto(base);

  await check("the dock opens under the chat and pushes it up", async () => {
    await page.waitForSelector('[data-testid="session-terminal-dock"]');
    await waitStatus("open");
    const chat = await box('[data-testid="chat"]');
    const dock = await box('[data-testid="session-terminal-dock"]');
    assert(Math.abs(chat.y + chat.height - dock.y) <= 1, `chat ends at ${chat.y + chat.height}, dock starts at ${dock.y}`);
    assert(dock.y + dock.height <= 801, "dock overflows the page");
    const composer = await box('[data-testid="composer"]');
    assert(composer.y + composer.height <= dock.y + 1, "composer is covered by the dock");
    await page.click('[data-testid="toggle-terminal"]');
    await page.waitForSelector('[data-testid="session-terminal-dock"]', { state: "detached" });
    const full = await box('[data-testid="chat"]');
    assert(full.height > chat.height + 100, "closing the dock did not give the chat its space back");
    await page.click('[data-testid="toggle-terminal"]');
    await waitStatus("open");
  });

  await check("typing reaches the shell and its output is rendered", async () => {
    await waitScreen(PROMPT);
    await typeLine("echo answer-$((6*7))");
    await waitScreen("answer-42");
    await typeLine("pwd");
    await waitScreen(work);
  });

  await check("resizing keeps the canvas at device resolution", async () => {
    // Record the canvas backing-store scale at the end of every task that
    // touched it: that is the state the next paint shows.
    await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="terminal-canvas-host"] canvas') as HTMLCanvasElement;
      const w = window as unknown as { __scales: number[]; __mo: MutationObserver };
      w.__scales = [];
      w.__mo = new MutationObserver(() => {
        const css = parseFloat(canvas.style.width);
        if (css > 0) w.__scales.push(canvas.width / css);
      });
      w.__mo.observe(canvas, { attributes: true });
    });
    const sep = await box('[role="separator"]');
    await page.mouse.move(sep.x + sep.width / 2, sep.y + sep.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(sep.x + sep.width / 2, sep.y + sep.height / 2 - i * 15);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const scales: number[] = await page.evaluate(() => {
      const w = window as unknown as { __scales: number[]; __mo: MutationObserver };
      w.__mo.disconnect();
      return w.__scales;
    });
    assert(scales.length > 0, "the drag did not resize the canvas");
    const bad = scales.filter((s) => Math.abs(s - 2) > 0.01);
    assert(bad.length === 0, `${bad.length} of ${scales.length} resize states were at scale ${bad[0]}, not 2`);
  });

  await check("the divider resizes the shell", async () => {
    const before = await sttySize();
    const sep = await box('[role="separator"]');
    await page.mouse.move(sep.x + sep.width / 2, sep.y + sep.height / 2);
    await page.mouse.down();
    await page.mouse.move(sep.x + sep.width / 2, sep.y - 150, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await sttySize();
    assert(after.rows > before.rows, `rows ${before.rows} → ${after.rows}`);
    assert(after.cols === before.cols, `cols changed ${before.cols} → ${after.cols}`);
  });

  await check("a synchronized-output update is never painted half-way", async () => {
    await typeLine("clear; for i in $(seq 1 80); do printf 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\\n'; done");
    await page.waitForTimeout(400);
    // On every animation frame, count lit pixels and note whether the update
    // has ended yet (its last bytes print SYNCDONE).
    await page.evaluate(() => {
      const host = document.querySelector('[data-testid="terminal-canvas-host"]') as HTMLElement & {
        __lfgTerminal?: { buffer: { active: { length: number; getLine(i: number): { translateToString(t: boolean): string } | undefined } } };
      };
      const canvas = host.querySelector("canvas") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      const w = window as unknown as { __frames: Array<{ lit: number; done: boolean }>; __stop: boolean };
      w.__frames = [];
      w.__stop = false;
      const ended = () => {
        const b = host.__lfgTerminal!.buffer.active;
        for (let i = 0; i < b.length; i++) if (b.getLine(i)?.translateToString(true).startsWith("SYNCDONE")) return true;
        return false;
      };
      const tick = () => {
        if (w.__stop) return;
        // The top-left corner only: it is full of X before the update and
        // empty once cleared, and a small read keeps every frame sampled.
        const { data } = ctx.getImageData(0, 0, Math.min(canvas.width, 480), Math.min(canvas.height, 240));
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 150) lit++;
        w.__frames.push({ lit, done: ended() });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // Begin an update, clear the screen, hold 120 ms, then draw and end it.
    // A terminal that ignores mode 2026 paints the empty screen meanwhile.
    await page.keyboard.type("printf '\\033[?2026h\\033[H\\033[2J'; sleep 0.12; printf 'SYNCDONE\\033[?2026l'");
    await page.keyboard.press("Enter");
    await waitScreen("SYNCDONE");
    await page.waitForTimeout(200);
    const frames: Array<{ lit: number; done: boolean }> = await page.evaluate(() => {
      const w = window as unknown as { __frames: Array<{ lit: number; done: boolean }>; __stop: boolean };
      w.__stop = true;
      return w.__frames;
    });
    const before = frames[0]?.lit ?? 0;
    assert(before > 200, `the screen was not filled first (${before} lit samples)`);
    // The finished screen is legitimately sparse (one word and a prompt).
    // Before the update ends, a sparse frame is the half-drawn state.
    const pending = frames.filter((f) => !f.done);
    const halfDrawn = pending.filter((f) => f.lit < before * 0.05);
    assert(pending.length >= 3, `only ${pending.length} frames were sampled during the update`);
    assert(halfDrawn.length === 0, `${halfDrawn.length} of ${pending.length} frames painted the cleared screen mid-update`);
  });

  await check("a cursor-position query gets exactly one reply", async () => {
    // The host answers queries; the browser must not answer a second time.
    // A second reply is input the app never asked for (a TUI reads it as
    // keystrokes). Read twice: the second read must time out empty.
    await typeLine(
      "clear; printf '\\033[6n'; IFS= read -rs -t 2 -d R a; IFS= read -rs -t 1 -d R b; echo replies=${#a},${#b}",
    );
    const text = await waitScreen(/replies=\d+,\d+/);
    const [, first, second] = text.match(/replies=(\d+),(\d+)/)!;
    assert(Number(first) >= 5, `the query got no reply (${first} bytes)`);
    assert(Number(second) === 0, `a second reply arrived (${second} bytes)`);
  });

  await check("a reload restores the screen and the same shell", async () => {
    await typeLine("clear; export E2E_STATE=kept-$((1+1)); echo before-reload");
    await waitScreen("before-reload");
    const pongBefore = await pingTermHost(hostOpts);
    await page.reload();
    // The snapshot arrives with the attach; nothing was typed after reload.
    await waitStatus("open");
    await waitScreen("before-reload", 3000);
    await typeLine("echo state=$E2E_STATE");
    await waitScreen("state=kept-2");
    const pongAfter = await pingTermHost(hostOpts);
    assert(pongAfter.pid === pongBefore.pid, "the terminal host restarted");
  });

  await check("a server restart reconnects to the same shell, screen intact", async () => {
    await typeLine("echo pre-restart-$((3*3))");
    await waitScreen("pre-restart-9");
    harness.kill("SIGKILL");
    await waitStatus("reconnecting");
    // The browser still shows the screen while the server is down.
    assert((await screen()).includes("pre-restart-9"), "screen was lost while disconnected");
    harness = await startHarness();
    await waitStatus("open", 15_000);
    await waitScreen("pre-restart-9");
    await typeLine("echo again=$E2E_STATE");
    await waitScreen("again=kept-2");
  });

  await check("tabs: a new tab is a new shell, switching back restores the first", async () => {
    await page.click('button[aria-label="New terminal"]');
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 2);
    await waitStatus("open");
    await waitScreen(PROMPT);
    assert(!(await screen()).includes("pre-restart-9"), "the new tab shows the first tab's screen");
    await typeLine("echo second-tab; echo E2E_STATE=[$E2E_STATE]");
    await waitScreen("E2E_STATE=[]");
    const tabs = page.locator('[role="tab"]');
    await tabs.nth(0).click();
    await waitStatus("open");
    await waitScreen("pre-restart-9");
    assert(!(await screen()).includes("second-tab"), "tab one shows tab two's output");
    const list = await (await fetch(`http://127.0.0.1:${harnessPort}/api/term/list?sessionId=e2e-session`)).json();
    assert(list.shells.length === 2, `host has ${list.shells.length} shells, expected 2`);
    // Close tab two from its × button: its shell ends.
    await page.click('[role="tablist"] > div:nth-child(2) button[aria-label^="Close"]');
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 1);
    const end = Date.now() + 3000;
    let shells = 2;
    while (Date.now() < end && shells !== 1) {
      shells = (await (await fetch(`http://127.0.0.1:${harnessPort}/api/term/list?sessionId=e2e-session`)).json()).shells.length;
      await page.waitForTimeout(50);
    }
    assert(shells === 1, `closing the tab left ${shells} shells`);
  });

  await check("a full-screen app survives a reload on its alternate screen", async () => {
    await typeLine("printf '\\033[?1049h\\033[2J\\033[5;10HALT-SCREEN-APP'; sleep 60");
    await waitScreen("ALT-SCREEN-APP");
    await page.reload();
    await waitStatus("open");
    await waitScreen("ALT-SCREEN-APP", 3000);
    const alt = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="terminal-canvas-host"]') as HTMLElement & {
        __lfgTerminal?: { buffer: { active: { type: string } } };
      };
      return host.__lfgTerminal?.buffer.active.type;
    });
    assert(alt === "alternate", `restored on the ${alt} screen`);
    await page.click('[data-testid="terminal-canvas-host"]');
    await page.keyboard.press("Control+C");
    await typeLine("printf '\\033[?1049l'; echo back-from-alt");
    await waitScreen("back-from-alt");
  });

  await check("on a phone, link chips stay tappable above the keys handle", async () => {
    const phone = await browser.newContext({
      viewport: { width: 390, height: 760 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const p = await phone.newPage();
    p.on("pageerror", onPageError);
    await p.goto(`${base}?sid=e2e-phone`);
    await p.waitForSelector('[data-terminal-status="open"]', { timeout: 10_000 });
    await p.tap('[data-testid="terminal-canvas-host"]');
    await p.keyboard.type("echo https://example.com/e2e/link-$((5+5))");
    await p.keyboard.press("Enter");
    const chip = p.locator('[data-testid="terminal-link-tray"] a').first();
    await chip.waitFor({ timeout: 8000 });
    assert((await chip.getAttribute("href")) === "https://example.com/e2e/link-10", "wrong link detected");
    const handle = await p.locator('button[aria-label="Show terminal keys"]').boundingBox();
    assert(handle, "the keys handle is not shown on a phone");
    const b = (await chip.boundingBox())!;
    const hit = await p.evaluate(
      ([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest("a")?.getAttribute("href") ?? null,
      [b.x + b.width / 2, b.y + b.height - 2],
    );
    assert(hit === "https://example.com/e2e/link-10", `the chip's lower edge hits ${hit}`);
    await phone.close();
  });

  await check("exit closes its tab, and the last tab closes the dock", async () => {
    await typeLine("exit");
    await page.waitForSelector('[data-testid="session-terminal-dock"]', { state: "detached", timeout: 8000 });
    const list = await (await fetch(`http://127.0.0.1:${harnessPort}/api/term/list?sessionId=e2e-session`)).json();
    assert(list.shells.length === 0, `${list.shells.length} shells left after exit`);
  });

  await check("a page from another site cannot open a shell", async () => {
    // A real page on another origin, served from this machine. A data: or
    // route-served page is not used: Chrome refuses their sockets on its own,
    // which would pass this check without the server's guard.
    const evilSite = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("<p>another site</p>", { headers: { "content-type": "text/html" } }),
    });
    const evil = await context.newPage();
    await evil.goto(`http://evil.test:${evilSite.port}/`);
    const outcome: string = await evil.evaluate(
      (url) =>
        new Promise<string>((done) => {
          const ws = new WebSocket(url);
          ws.onopen = () => done("opened");
          ws.onerror = () => done("refused");
          setTimeout(() => done("timeout"), 4000);
        }),
      `ws://127.0.0.1:${harnessPort}/api/term?session=cross-site-probe`,
    );
    await evil.close();
    evilSite.stop(true);
    assert(outcome === "refused", `the cross-site socket was ${outcome}`);
    const list = await (await fetch(`http://127.0.0.1:${harnessPort}/api/term/list?session=cross-site-probe`)).json();
    assert(list.shells.length === 0, "a shell was started for the other site");
  });

  await check("no page errors", async () => {
    assert(pageErrors.length === 0, pageErrors.join("\n"));
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error(e);
} finally {
  try {
    const pong = await pingTermHost({ ...hostOpts, spawn: false });
    process.kill(pong.pid, "SIGTERM");
  } catch {}
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {}
  }
  rmSync(work, { recursive: true, force: true });
  process.exit(exitCode);
}
