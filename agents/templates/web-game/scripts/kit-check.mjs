// Shared parts of `bun run check:ui` and `bun run check:play`: the build, a
// static server for dist/, a headless browser (Bun.WebView, or Chrome over
// CDP), the console recorder, the control hint rule and the sample art check.
// No dependencies: Bun and a Chrome-family browser are enough, and no desktop.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const dist = join(root, "dist");
export const say = (s = "") => console.log(s);

const cleanups = [];
export const onCleanup = (fn) => cleanups.push(fn);
export async function cleanup() {
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

/** Build dist/ when it is stale. `--rebuild` always builds; `--no-build` never does. */
export async function ensureDist(args) {
  if (!args.has("--rebuild") && distIsFresh()) return "reused (fresh)";
  if (args.has("--no-build")) { if (!existsSync(join(dist, "index.html"))) throw new Error("dist/index.html is missing and --no-build was given"); return "reused (--no-build)"; }
  const proc = Bun.spawn(["bun", "run", "build"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  onCleanup(() => proc.kill());
  const timer = setTimeout(() => proc.kill(), 300_000);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if ((await proc.exited) !== 0) throw new Error(`bun run build failed:\n${(out + err).split("\n").slice(-20).join("\n")}`);
  return "rebuilt";
}

/** Serve dist/ on 127.0.0.1 with the index page as the fallback. Returns the base URL. */
export function serveDist() {
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, path);
      if (!relative(dist, f).startsWith("..") && existsSync(f) && !statSync(f).isDirectory()) return new Response(Bun.file(f));
      return new Response(Bun.file(join(dist, "index.html")), { headers: { "content-type": "text/html" } });
    },
  });
  onCleanup(() => server.stop(true));
  return `http://127.0.0.1:${server.port}`;
}

// Injected before every page script: records console errors and failed requests.
export const RECORDER = `(()=>{const s=window.__uiCheck={console:[],failed:[]};const oe=console.error;
console.error=function(...a){try{s.console.push(a.map(x=>x&&x.message||String(x)).join(' ').slice(0,300))}catch{}return oe.apply(console,a)};
addEventListener('error',e=>{if(e.target&&e.target!==window&&(e.target.src||e.target.href))s.failed.push('resource '+(e.target.src||e.target.href));else s.console.push('uncaught: '+e.message)},true);
addEventListener('unhandledrejection',e=>s.console.push('unhandled rejection: '+((e.reason&&e.reason.message)||e.reason)));
const of=window.fetch;window.fetch=async function(i,init){const u=typeof i==='string'?i:(i&&i.url)||String(i);const m=(init&&init.method)||(i&&i.method)||'GET';
try{const r=await of.apply(this,arguments);if(!r.ok)s.failed.push(r.status+' '+m+' '+u);return r}catch(err){s.failed.push('FAILED '+m+' '+u+' ('+err.message+')');throw err}};})()`;

export const PAGE_STATE = `(()=>({text:document.body?document.body.innerText:'',canvas:document.querySelectorAll('canvas').length,errors:(window.__uiCheck||{console:[],failed:[]})}))()`;
export const ERROR_TEXT = /something went wrong|unhandled (runtime )?error|application error|uncaught (error|exception)|cannot read propert|is not a function|is not defined|minified react error/i;
export const consoleErrors = (state) => [...new Set(state.errors.console.filter((t) => !/download the react devtools/i.test(t)))];

// The canvas area below the HUD row, in CSS pixels (works for 2D and WebGL canvases).
const CANVAS_RECT = `(()=>{const c=document.querySelector('canvas');if(!c)return null;const r=c.getBoundingClientRect();return {x:r.left,y:r.top+70,width:r.width,height:Math.max(1,r.height-70),scale:1}})()`;
/** A hash of the canvas pixels under the HUD, or null when there is no canvas. */
export async function canvasHash(browser) {
  const clip = await browser.evaluate(CANVAS_RECT);
  if (!clip) return null;
  const shot = await browser.cdp("Page.captureScreenshot", { format: "png", clip });
  return String(Bun.hash(shot.data));
}

async function openChrome(outDir) {
  const candidates = [process.env.CHROME_PATH, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"].filter(Boolean);
  const pw = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  if (existsSync(pw)) for (const d of readdirSync(pw)) if (d.startsWith("chromium")) candidates.push(join(pw, d, "chrome-linux", "chrome"), join(pw, d, "chrome-linux64", "chrome"));
  const bin = candidates.map((c) => (c.includes("/") ? (existsSync(c) ? c : null) : Bun.which(c))).find(Boolean);
  if (!bin) throw new Error("No Bun.WebView and no Chrome found (set CHROME_PATH)");
  const profile = join(outDir, `.chrome-${process.pid}`);
  mkdirSync(profile, { recursive: true });
  const flags = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--mute-audio", "about:blank"];
  if (process.getuid?.() === 0) flags.push("--no-sandbox");
  const proc = Bun.spawn([bin, ...flags], { stdout: "ignore", stderr: "ignore" });
  onCleanup(() => { proc.kill(); rmSync(profile, { recursive: true, force: true }); });
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
      const want = url.split("#")[0];
      for (let i = 0; i < 150; i++) { if (await evaluate("location.href+'|'+document.readyState").then((v) => v.startsWith(want) && v.endsWith("complete")).catch(() => false)) return; await Bun.sleep(100); }
    },
  };
}

/** A headless browser page: Bun.WebView when this Bun has it, else Chrome over CDP. UI_CHECK_CHROME=1 forces Chrome. */
export async function openBrowser({ width, height, outDir }) {
  if (typeof Bun.WebView === "function" && !process.env.UI_CHECK_CHROME) {
    try {
      const view = new Bun.WebView({ width, height });
      onCleanup(() => view.close());
      await view.navigate("about:blank");
      return { name: "Bun.WebView", cdp: (m, p) => view.cdp(m, p), evaluate: (e) => view.evaluate(e), navigate: (u) => view.navigate(u) };
    } catch {}
  }
  return openChrome(outDir);
}

/** Phone size with touch, and the console recorder on every new page. */
export async function setupPhone(browser, { width, height }) {
  await browser.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }).catch(() => {});
  await browser.cdp("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await browser.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
}

// ---------- the control hint must name the control on the screen ----------

/**
 * Words the menu hint must use (and must not use) for each control kind in
 * about.ts (GAME.controls.kind). "Drag left or right" over a pair of arrow
 * buttons was a real published bug: the player dragged and nothing moved.
 */
export const CONTROL_WORDS = {
  drag: { need: /\b(drag|slide|swipe)/i, not: /\b(joy)?stick\b|\barrow buttons?\b/i, say: '"drag" (or slide, swipe), and no stick' },
  stick: { need: /\b(joy)?stick\b/i, not: null, say: '"stick"' },
  dpad: { need: /\b(arrow|button|pad|tap|press)/i, not: /\b(drag|swipe|slide)\b|\bstick\b/i, say: '"arrows", "buttons" or "tap", and no drag' },
  steer: { need: /\b(arrow|button|tap|press|hold|steer)/i, not: /\b(drag|swipe|slide)\b|\bstick\b/i, say: '"buttons", "arrows" or "tap", and no drag' },
  buttons: { need: /\b(tap|press|hold|button)/i, not: /\b(drag|swipe|slide)\b|\bstick\b/i, say: '"tap" or "button", and no drag or stick' },
};

/** Null when the hint fits the control, else the problem in one line. */
export function hintProblem(kind, hint) {
  const rule = CONTROL_WORDS[kind];
  if (!rule) return `unknown control kind "${kind}"`;
  const text = String(hint ?? "").trim();
  if (!text) return null; // no hint shown (a best score replaces it)
  if (!rule.need.test(text) || (rule.not && rule.not.test(text))) {
    return `the menu hint "${text.slice(0, 80)}" does not describe the "${kind}" control on /play. Say ${rule.say}. Fix GAME.controls in src/app/about.ts`;
  }
  return null;
}

/** The touch hint on the menu (the footer before a best score exists). */
export const MENU_HINT = `(()=>{const f=document.querySelector('.menu-footer');return f?f.innerText.trim():''})()`;
/** The control kind that TouchControls draws on /play. */
export const CONTROL_KIND = `(()=>{const e=document.querySelector('[data-control-kind]');return e?e.getAttribute('data-control-kind'):((window.__omgTest&&window.__omgTest.kind)||null)})()`;

// ---------- the kit's sample art must not be published ----------

/** sha256 of every sample file in the template (public/icons, public/og.png, public/art). */
export const SAMPLE_ASSETS = JSON.parse(readFileSync(join(root, "scripts", "sample-assets.json"), "utf8"));
/** OMG_KIT_SAMPLE=1: this is the kit's own sample game, so its sample art is expected. */
export const SAMPLE_RUN = process.env.OMG_KIT_SAMPLE === "1";

/** Every image the page uses: icons, install manifest icons, share image, <img> and screen backgrounds. */
export const PAGE_IMAGES = `(async()=>{const u=new Set();const add=(x)=>{if(x)try{u.add(new URL(x,location.href).href)}catch{}};
document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]').forEach(l=>add(l.href));
const og=document.querySelector('meta[property="og:image"]');if(og)add(og.content);
document.querySelectorAll('img').forEach(i=>add(i.currentSrc||i.src));
document.querySelectorAll('.screen-bg').forEach(e=>{const m=/url\\(["']?([^"')]+)["']?\\)/.exec(getComputedStyle(e).backgroundImage);if(m)add(m[1])});
const m=document.querySelector('link[rel="manifest"]');if(m){try{const j=await (await fetch(m.href)).json();for(const i of j.icons||[])add(new URL(i.src,m.href).href)}catch{}}
return [...u]})()`;

/**
 * The published addresses of the sample files (/icons/..., /og.png, /art/...).
 * The dev server does not link the install icons, so check them directly too.
 */
export const samplePaths = (base) => Object.values(SAMPLE_ASSETS).map((f) => `${base}/${f.replace(/^public\//, "")}`);

/** The sample files among `urls`: [{ url, file }]. */
export async function sampleArtIn(urls) {
  const found = [];
  for (const url of new Set(urls)) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const hash = new Bun.CryptoHasher("sha256").update(new Uint8Array(await res.arrayBuffer())).digest("hex");
      if (SAMPLE_ASSETS[hash]) found.push({ url, file: SAMPLE_ASSETS[hash] });
    } catch {}
  }
  return found;
}

export function sampleArtLines(found) {
  return [
    `PLACEHOLDER ART: ${found.length} file(s) on the page are still the kit's Coin Dash sample art:`,
    ...found.map((f) => `     ${f.file}  (${f.url.replace(/^https?:\/\/[^/]+/, "")})`),
    "     Replace them with this game's art: src/app/art.ts (hero, scoreIcon, items), public/icons/ (192, 512, 512 maskable, 180) and public/og.png (1200 x 630).",
  ];
}
