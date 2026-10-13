#!/usr/bin/env bun
// UI self-check: open every screen of the static web export at phone size.
//
//   bun run check:ui             build dist when it is stale, then check
//   bun run check:ui --rebuild   always rebuild dist first
//   bun run check:ui --no-build  never build; fail when dist is missing
//
// For each route it saves .omg/ui-check/<route>.png and reports a blank page,
// an error boundary, console errors, failed network requests and any button or
// link that another element covers at its centre. If package.json has a
// `server` or `backend` script, it starts it and confirms it answers.
// Exit code 1: build failure, server crash, blank page or error boundary.
// Uses Bun.WebView; falls back to headless Chrome over CDP. Stops everything
// it started when it ends.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { announcedPort, coveredElements, discoverRoutes, firstErrorLines, isIgnorableConsole, judgePage, routeFailed, routeFileName } from "./check-ui-rules.mjs";

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
  const inputs = [...walk(join(root, "src")), join(root, "app.json"), join(root, "package.json")].filter(existsSync);
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

function serveDist() {
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname).replace(/\/+$/, "");
      for (const c of [path, `${path}.html`, `${path}/index.html`]) {
        const f = join(dist, c);
        if (relative(dist, f).startsWith("..") || !existsSync(f) || statSync(f).isDirectory()) continue;
        return new Response(Bun.file(f));
      }
      const nf = join(dist, "+not-found.html");
      return existsSync(nf) ? new Response(Bun.file(nf), { status: 404, headers: { "content-type": "text/html" } }) : new Response("Not found", { status: 404 });
    },
  });
  cleanups.push(() => server.stop(true));
  return `http://127.0.0.1:${server.port}`;
}

async function freePort() {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = s.port; await s.stop(true); return port;
}

/** Start the app's own server script, if it has one. Returns a report line and whether it failed. */
async function startAppServer() {
  const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {};
  const name = ["server", "backend"].find((n) => scripts[n]);
  if (!name) return { line: "app server: none (no `server` or `backend` script)", failed: false };
  const port = await freePort();
  const proc = Bun.spawn(["bun", "run", name], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, PORT: String(port) }, detached: true });
  let output = "";
  const pump = async (s) => { const d = new TextDecoder(); for await (const c of s) output += d.decode(c); };
  pump(proc.stdout).catch(() => {}); pump(proc.stderr).catch(() => {});
  let exited;
  proc.exited.then((c) => { exited = c; });
  cleanups.push(() => { try { process.kill(-proc.pid, "SIGTERM"); } catch { try { proc.kill(); } catch {} } });
  const label = `app server: bun run ${name}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (exited !== undefined) {
      return { line: `${label} -> CRASHED (exit ${exited})\n${firstErrorLines(output).map((l) => `    ${l}`).join("\n") || "    (no output)"}`, failed: true };
    }
    const target = announcedPort(output) ?? (Date.now() - (deadline - 15_000) > 3000 ? port : undefined);
    if (target) {
      try {
        const r = await fetch(`http://127.0.0.1:${target}/`, { signal: AbortSignal.timeout(1500) });
        return { line: `${label} -> http://127.0.0.1:${target} answers (HTTP ${r.status})`, failed: false, alive: () => exited === undefined, output: () => output };
      } catch {}
    }
    await Bun.sleep(250);
  }
  return { line: `${label} -> did not answer within 15 s\n${firstErrorLines(output).map((l) => `    ${l}`).join("\n") || "    (no output)"}`, failed: true };
}

// Injected before every page script: records console errors and failed requests.
const RECORDER = `(()=>{const s=window.__uiCheck={console:[],failed:[]};const oe=console.error;
console.error=function(...a){try{s.console.push(a.map(x=>x&&x.message||String(x)).join(' ').slice(0,300))}catch{}return oe.apply(console,a)};
addEventListener('error',e=>{if(e.target&&e.target!==window&&(e.target.src||e.target.href))s.failed.push('resource '+(e.target.src||e.target.href));else s.console.push('uncaught: '+e.message)},true);
addEventListener('unhandledrejection',e=>s.console.push('unhandled rejection: '+((e.reason&&e.reason.message)||e.reason)));
const of=window.fetch;window.fetch=async function(i,init){const u=typeof i==='string'?i:(i&&i.url)||String(i);const m=(init&&init.method)||(i&&i.method)||'GET';
try{const r=await of.apply(this,arguments);if(!r.ok)s.failed.push(r.status+' '+m+' '+u);return r}catch(err){s.failed.push('FAILED '+m+' '+u+' ('+err.message+')');throw err}};
const ox=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){this.addEventListener('loadend',()=>{if(this.status===0||this.status>=400)s.failed.push((this.status||'FAILED')+' '+m+' '+u)});return ox.apply(this,arguments)};})()`;

// Runs in the page. Lists interactive elements whose centre is covered by another element.
const PROBE = `(()=>{
const vw=innerWidth,vh=innerHeight;
const sel='[role=button],[role=link],[role=tab],button,a[href],[data-focusable=true],[tabindex="0"]';
const name=(e)=>((e.getAttribute('aria-label')||e.innerText||e.getAttribute('data-testid')||e.getAttribute('role')||e.tagName)+'').trim().replace(/\\s+/g,' ').slice(0,40);
const visible=(e)=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width>=4&&r.height>=4&&c.visibility!=='hidden'&&c.display!=='none'&&c.opacity!=='0'&&!e.closest('[aria-hidden=true]')&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'};
const probe=(e)=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(x<0||y<0||x>=vw||y>=vh)return null;
const t=document.elementFromPoint(x,y);const relation=!t?'none':t===e?'self':e.contains(t)?'descendant':t.contains(e)?'ancestor':'other';return{relation,by:t&&relation==='other'?name(t):undefined,at:{x:Math.round(x),y:Math.round(y)}}};
const seen=new Set(),elements=[];
for(const e of document.querySelectorAll(sel)){if(!visible(e))continue;
let p=probe(e);
if(!p||p.relation==='other'){e.scrollIntoView({block:p?'center':'nearest',inline:'nearest',behavior:'instant'});p=probe(e);
 if(!p||p.relation==='other'){e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});p=probe(e)}}
if(!p)continue;const key=name(e)+JSON.stringify(p.at);if(seen.has(key))continue;seen.add(key);elements.push({label:name(e),...p})}
return elements})()`;

const PAGE_STATE = `(()=>({text:document.body?document.body.innerText:'',media:document.querySelectorAll('img,svg,canvas,video').length,errors:(window.__uiCheck||{console:[],failed:[]})}))()`;

async function openChrome() {
  const candidates = [process.env.CHROME_PATH, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"].filter(Boolean);
  const pw = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  if (existsSync(pw)) for (const d of readdirSync(pw)) if (d.startsWith("chromium")) candidates.push(join(pw, d, "chrome-linux", "chrome"));
  const bin = candidates.map((c) => (c.includes("/") ? (existsSync(c) ? c : null) : Bun.which(c))).find(Boolean);
  if (!bin) throw new Error("No Bun.WebView and no Chrome found (set CHROME_PATH)");
  const profile = join(outDir, `.chrome-${process.pid}`);
  mkdirSync(profile, { recursive: true });
  const flags = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "about:blank"];
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

async function checkRoute(browser, base, route) {
  const url = base + (route === "/" ? "/" : route);
  const result = { route, png: "", blank: false, errorBoundary: false, reason: "", console: [], failed: [], covered: [] };
  try {
    await browser.navigate(url);
    let state;
    const deadline = Date.now() + 10_000;
    do { await Bun.sleep(250); state = await browser.evaluate(PAGE_STATE); } while (Date.now() < deadline && state.text.trim().length === 0);
    await Bun.sleep(600);
    state = await browser.evaluate(PAGE_STATE);
    Object.assign(result, judgePage(state));
    const shot = await browser.cdp("Page.captureScreenshot", { format: "png" });
    const file = join(outDir, `${routeFileName(route)}.png`);
    await Bun.write(file, Buffer.from(shot.data, "base64"));
    result.png = relative(root, file);
    result.covered = coveredElements(await browser.evaluate(PROBE));
    const after = await browser.evaluate(PAGE_STATE);
    result.console = [...new Set(after.errors.console.filter((t) => !isIgnorableConsole(t)))];
    result.failed = [...new Set(after.errors.failed)];
  } catch (e) {
    result.loadError = String(e?.message ?? e);
  }
  return result;
}

function printRoute(r) {
  const status = routeFailed(r) ? "FAIL" : r.console.length || r.failed.length || r.covered.length ? "WARN" : "OK  ";
  const why = r.loadError ? `could not check: ${r.loadError}` : r.errorBoundary ? `error boundary: ${r.reason}` : r.blank ? `blank page: ${r.reason}` : "";
  say(`${status} ${r.route}${why ? `  ${why}` : ""}${r.png ? `  ${r.png}` : ""}`);
  for (const c of r.console.slice(0, 5)) say(`     console error: ${c}`);
  for (const f of r.failed.slice(0, 5)) say(`     failed request: ${f}`);
  for (const c of r.covered.slice(0, 8)) say(`     COVERED: "${c.label}" at (${c.at.x},${c.at.y}) is under "${c.by}"`);
}

async function main() {
  say(`check:ui  ${WIDTH}x${HEIGHT}`);
  const distState = await ensureDist();
  const { routes, skipped } = discoverRoutes(walk(dist).map((f) => relative(dist, f)));
  say(`dist: ${distState}; ${routes.length} route(s)${skipped.length ? `; skipped dynamic: ${skipped.join(", ")}` : ""}`);
  if (!routes.length) throw new Error("no routes found in dist");
  const app = await startAppServer();
  say(app.line);
  const base = serveDist();
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith(".png")) rmSync(join(outDir, f));
  const browser = await openBrowser();
  await browser.cdp("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: true });
  await browser.cdp("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  say(`browser: ${browser.name}`);
  say();
  const results = [];
  for (const route of routes) { const r = await checkRoute(browser, base, route); results.push(r); printRoute(r); }
  let failed = app.failed || results.some(routeFailed);
  if (app.alive && !app.alive()) { failed = true; say(`app server CRASHED while the routes loaded\n${firstErrorLines(app.output()).map((l) => `    ${l}`).join("\n")}`); }
  const warns = results.filter((r) => !routeFailed(r) && (r.console.length || r.failed.length || r.covered.length)).length;
  say();
  say(`RESULT: ${failed ? "FAIL" : warns ? "WARN" : "PASS"}  routes=${results.length} failed=${results.filter(routeFailed).length} with-warnings=${warns}${app.failed ? " server=FAILED" : ""}`);
  if (warns || failed) say("Open the PNGs, fix each item, and run `bun run check:ui` again.");
  return failed ? 1 : 0;
}

let code = 1;
try { code = await main(); } catch (e) { say(`check:ui could not run: ${e?.message ?? e}`); }
await cleanup();
process.exit(code);
