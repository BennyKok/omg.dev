#!/usr/bin/env bun
// UI self-check: build the game, open every screen at phone size, and play it.
//
//   bun run check:ui             build dist when it is stale, then check
//   bun run check:ui --rebuild   always rebuild dist first
//   bun run check:ui --no-build  never build; fail when dist is missing
//
// Screens come from the ROUTES list in src/app/routes.tsx. For each screen it
// saves .omg/ui-check/<screen>.png and reports a blank page, error text,
// console errors, failed requests, and any button that another element covers.
// On /play it also holds movement keys for about a second and checks that the
// canvas changes, so a game that does not run fails the check.
// Exit code 1: build failure, blank page, error text, or a canvas that does not draw.
// Uses Bun.WebView; falls back to headless Chrome over CDP. Stops everything
// it started when it ends.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dist = join(root, "dist");
const outDir = join(root, ".omg", "ui-check");
const WIDTH = 390, HEIGHT = 844;
const cleanups = [];
const say = (s = "") => console.log(s);

async function cleanup() {
  while (cleanups.length) { try { await cleanups.pop()(); } catch {} }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanup().finally(() => process.exit(130)); });

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out); } else out.push(p);
  }
  return out;
}

function distIsFresh() {
  const index = join(dist, "index.html");
  if (!existsSync(index)) return false;
  const built = statSync(index).mtimeMs;
  const inputs = [...walk(join(root, "src")), ...walk(join(root, "public")), ...["index.html", "package.json", "vite.config.ts"].map((f) => join(root, f))].filter(existsSync);
  return inputs.every((f) => statSync(f).mtimeMs <= built);
}

async function ensureDist() {
  if (!args.has("--rebuild") && distIsFresh()) return "reused (fresh)";
  if (args.has("--no-build")) { if (!existsSync(join(dist, "index.html"))) throw new Error("dist/index.html is missing and --no-build was given"); return "reused (--no-build)"; }
  const proc = Bun.spawn(["bun", "run", "build"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  cleanups.push(() => proc.kill());
  const timer = setTimeout(() => proc.kill(), 300_000);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if ((await proc.exited) !== 0) throw new Error(`bun run build failed:\n${(out + err).split("\n").slice(-20).join("\n")}`);
  return "rebuilt";
}

/** The "/path": Component entries of ROUTES in src/app/routes.tsx. */
function readRoutes() {
  const src = readFileSync(join(root, "src", "app", "routes.tsx"), "utf8");
  const block = /ROUTES[^=]*=\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
  const routes = [...block.matchAll(/["'](\/[^"']*)["']\s*:/g)].map((m) => m[1]);
  return routes.length ? [...new Set(routes)] : ["/"];
}

function serveDist() {
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, path);
      if (!relative(dist, f).startsWith("..") && existsSync(f) && !statSync(f).isDirectory()) return new Response(Bun.file(f));
      return new Response(Bun.file(join(dist, "index.html")), { headers: { "content-type": "text/html" } });
    },
  });
  cleanups.push(() => server.stop(true));
  return `http://127.0.0.1:${server.port}`;
}

// Injected before every page script: records console errors and failed requests.
const RECORDER = `(()=>{const s=window.__uiCheck={console:[],failed:[]};const oe=console.error;
console.error=function(...a){try{s.console.push(a.map(x=>x&&x.message||String(x)).join(' ').slice(0,300))}catch{}return oe.apply(console,a)};
addEventListener('error',e=>{if(e.target&&e.target!==window&&(e.target.src||e.target.href))s.failed.push('resource '+(e.target.src||e.target.href));else s.console.push('uncaught: '+e.message)},true);
addEventListener('unhandledrejection',e=>s.console.push('unhandled rejection: '+((e.reason&&e.reason.message)||e.reason)));
const of=window.fetch;window.fetch=async function(i,init){const u=typeof i==='string'?i:(i&&i.url)||String(i);const m=(init&&init.method)||(i&&i.method)||'GET';
try{const r=await of.apply(this,arguments);if(!r.ok)s.failed.push(r.status+' '+m+' '+u);return r}catch(err){s.failed.push('FAILED '+m+' '+u+' ('+err.message+')');throw err}};})()`;

// Runs in the page. Lists interactive elements whose centre is covered by another element.
const PROBE = `(()=>{
const sel='[role=button],[role=slider],[role=switch],button,a[href]';
const name=(e)=>((e.getAttribute('aria-label')||e.innerText||e.tagName)+'').trim().replace(/\\s+/g,' ').slice(0,40);
const out=[];
for(const e of document.querySelectorAll(sel)){const r=e.getBoundingClientRect(),c=getComputedStyle(e);
if(r.width<4||r.height<4||c.visibility==='hidden'||c.display==='none'||e.disabled)continue;
const x=r.left+r.width/2,y=r.top+r.height/2;if(x<0||y<0||x>=innerWidth||y>=innerHeight){out.push({label:name(e),by:'the screen edge',at:{x:Math.round(x),y:Math.round(y)}});continue}
const t=document.elementFromPoint(x,y);if(t&&t!==e&&!e.contains(t)&&!t.contains(e))out.push({label:name(e),by:name(t),at:{x:Math.round(x),y:Math.round(y)}})}
return out})()`;

const PAGE_STATE = `(()=>({text:document.body?document.body.innerText:'',canvas:document.querySelectorAll('canvas').length,errors:(window.__uiCheck||{console:[],failed:[]})}))()`;
const ERROR_TEXT = /something went wrong|unhandled (runtime )?error|application error|uncaught (error|exception)|cannot read propert|is not a function|is not defined|minified react error/i;
// A cheap fingerprint of the canvas pixels.
const CANVAS_HASH = `(()=>{const c=document.querySelector('canvas');if(!c)return null;const d=c.toDataURL();let h=0;for(let i=0;i<d.length;i+=7)h=(h*31+d.charCodeAt(i))|0;return h+':'+d.length})()`;

async function openChrome() {
  const candidates = [process.env.CHROME_PATH, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"].filter(Boolean);
  const pw = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  if (existsSync(pw)) for (const d of readdirSync(pw)) if (d.startsWith("chromium")) candidates.push(join(pw, d, "chrome-linux", "chrome"));
  const bin = candidates.map((c) => (c.includes("/") ? (existsSync(c) ? c : null) : Bun.which(c))).find(Boolean);
  if (!bin) throw new Error("No Bun.WebView and no Chrome found (set CHROME_PATH)");
  const profile = join(outDir, `.chrome-${process.pid}`);
  mkdirSync(profile, { recursive: true });
  const flags = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--mute-audio", "about:blank"];
  if (process.getuid?.() === 0) flags.push("--no-sandbox");
  const proc = Bun.spawn([bin, ...flags], { stdout: "ignore", stderr: "ignore" });
  cleanups.push(() => { proc.kill(); rmSync(profile, { recursive: true, force: true }); });
  let ws;
  for (let i = 0; i < 100 && !ws; i++) {
    try { const [port, path] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n"); ws = `ws://127.0.0.1:${port}${path}`; } catch { await Bun.sleep(100); }
  }
  if (!ws) throw new Error("Chrome did not start a DevTools port");
  const sock = new WebSocket(ws);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = () => rej(new Error("DevTools connection failed")); });
  let next = 0; const waiting = new Map();
  sock.onmessage = (m) => { const d = JSON.parse(m.data); const w = waiting.get(d.id); if (w) { waiting.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++next; waiting.set(id, { res, rej }); sock.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result.value;
  };
  return {
    name: "headless Chrome", cdp, evaluate,
    async navigate(url) {
      await cdp("Page.navigate", { url });
      for (let i = 0; i < 150; i++) { if (await evaluate("location.href+'|'+document.readyState").then((v) => v.startsWith(url) && v.endsWith("complete")).catch(() => false)) return; await Bun.sleep(100); }
    },
  };
}

async function openBrowser() {
  if (typeof Bun.WebView === "function" && !process.env.UI_CHECK_CHROME) {
    try {
      const view = new Bun.WebView({ width: WIDTH, height: HEIGHT });
      cleanups.push(() => view.close());
      await view.navigate("about:blank");
      return { name: "Bun.WebView", cdp: (m, p) => view.cdp(m, p), evaluate: (e) => view.evaluate(e), navigate: (u) => view.navigate(u) };
    } catch {}
  }
  return openChrome();
}

const KEYS = { d: 68, s: 83, w: 87, a: 65, " ": 32 };
async function key(browser, type, k) {
  await browser.cdp("Input.dispatchKeyEvent", { type, key: k, code: k === " " ? "Space" : `Key${k.toUpperCase()}`, windowsVirtualKeyCode: KEYS[k], nativeVirtualKeyCode: KEYS[k] });
}

/** Hold movement keys and confirm the canvas draws new frames. */
async function playCheck(browser) {
  const before = await browser.evaluate(CANVAS_HASH);
  if (before === null) return { ok: false, line: "no <canvas> on /play" };
  for (const k of ["d", "s"]) await key(browser, "keyDown", k);
  await Bun.sleep(1200);
  for (const k of ["d", "s"]) await key(browser, "keyUp", k);
  const after = await browser.evaluate(CANVAS_HASH);
  return before === after
    ? { ok: false, line: "the canvas did not change in 1.2 s with keys held: the loop or the drawing does not run" }
    : { ok: true, line: "the canvas changed while D and S were held" };
}

async function checkRoute(browser, base, route, n) {
  // A fresh page per screen (the query changes), so each screen starts clean.
  const url = `${base}/?check=${n}#${route}`;
  const r = { route, png: "", fail: "", console: [], failed: [], covered: [], play: null };
  try {
    await browser.navigate(url);
    let state;
    const deadline = Date.now() + 10_000;
    do { await Bun.sleep(250); state = await browser.evaluate(PAGE_STATE); } while (Date.now() < deadline && !state.text.trim() && !state.canvas);
    await Bun.sleep(600);
    state = await browser.evaluate(PAGE_STATE);
    const text = state.text.trim();
    if (ERROR_TEXT.test(text.slice(0, 2000))) r.fail = `error text: "${text.replace(/\s+/g, " ").slice(0, 80)}"`;
    else if (!text && !state.canvas) r.fail = "blank page: no visible text and no canvas";
    if (route === "/play" && !r.fail) {
      r.play = await playCheck(browser);
      if (!r.play.ok) r.fail = r.play.line;
    }
    const shot = await browser.cdp("Page.captureScreenshot", { format: "png" });
    const file = join(outDir, `${route.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._-]+/g, "_") || "index"}.png`);
    await Bun.write(file, Buffer.from(shot.data, "base64"));
    r.png = relative(root, file);
    r.covered = await browser.evaluate(PROBE);
    const after = await browser.evaluate(PAGE_STATE);
    r.console = [...new Set(after.errors.console.filter((t) => !/download the react devtools/i.test(t)))];
    r.failed = [...new Set(after.errors.failed)];
  } catch (e) {
    r.fail = `could not check: ${e?.message ?? e}`;
  }
  return r;
}

async function main() {
  say(`check:ui  ${WIDTH}x${HEIGHT} (touch)`);
  const distState = await ensureDist();
  const routes = readRoutes();
  say(`dist: ${distState}; screens: ${routes.join(" ")}`);
  const base = serveDist();
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith(".png")) rmSync(join(outDir, f));
  const browser = await openBrowser();
  await browser.cdp("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
  await browser.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }).catch(() => {});
  await browser.cdp("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  say(`browser: ${browser.name}`);
  say();
  const results = [];
  for (const [i, route] of routes.entries()) {
    const r = await checkRoute(browser, base, route, i);
    results.push(r);
    const warn = r.console.length || r.failed.length || r.covered.length;
    say(`${r.fail ? "FAIL" : warn ? "WARN" : "OK  "} ${route}${r.fail ? `  ${r.fail}` : ""}${r.png ? `  ${r.png}` : ""}`);
    if (r.play?.ok) say(`     play: ${r.play.line}`);
    for (const c of r.console.slice(0, 5)) say(`     console error: ${c}`);
    for (const f of r.failed.slice(0, 5)) say(`     failed request: ${f}`);
    for (const c of r.covered.slice(0, 8)) say(`     COVERED: "${c.label}" at (${c.at.x},${c.at.y}) is under "${c.by}"`);
  }
  const failed = results.filter((r) => r.fail).length;
  const warns = results.filter((r) => !r.fail && (r.console.length || r.failed.length || r.covered.length)).length;
  say();
  say(`RESULT: ${failed ? "FAIL" : warns ? "WARN" : "PASS"}  screens=${results.length} failed=${failed} with-warnings=${warns}`);
  if (failed || warns) say("Open the PNGs, fix each item, and run `bun run check:ui` again.");
  return failed ? 1 : 0;
}

let code = 1;
try { code = await main(); } catch (e) { say(`check:ui could not run: ${e?.message ?? e}`); }
await cleanup();
process.exit(code);
