#!/usr/bin/env bun
// UI self-check: build the game, open every screen at two phone sizes
// (390x844 and the small 360x640), and play it.
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
// It also fails a button that is not fully on screen (partly outside the
// edge), the most common phone layout bug.
// It fails a menu hint that names another control than the one on /play
// (GAME.controls in src/app/about.ts), and warns loudly while the page still
// shows the kit's sample art (icons, share image, hero, score icon).
// Exit code 1: build failure, blank page, error text, a canvas that does not
// draw, a button that is off screen, or a wrong control hint.
// Uses Bun.WebView; falls back to headless Chrome over CDP. Stops everything
// it started when it ends. `bun run check:play` plays a whole round.
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CONTROL_KIND, ERROR_TEXT, MENU_HINT, PAGE_IMAGES, PAGE_STATE, SAMPLE_RUN, canvasHash, cleanup, consoleErrors, ensureDist, hintProblem,
  openBrowser, root, sampleArtIn, sampleArtLines, samplePaths, say, serveDist, setupPhone,
} from "./kit-check.mjs";

const args = new Set(process.argv.slice(2));
const outDir = join(root, ".omg", "ui-check");
const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 640 }];
let WIDTH = 390, HEIGHT = 844;

/** The "/path": Component entries of ROUTES in src/app/routes.tsx. */
function readRoutes() {
  const src = readFileSync(join(root, "src", "app", "routes.tsx"), "utf8");
  const block = /ROUTES[^=]*=\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
  const routes = [...block.matchAll(/["'](\/[^"']*)["']\s*:/g)].map((m) => m[1]);
  return routes.length ? [...new Set(routes)] : ["/"];
}

// Runs in the page. Lists interactive elements whose centre is covered by another element.
const PROBE = `(()=>{
const sel='[role=button],[role=slider],[role=switch],button,a[href]';
const name=(e)=>((e.getAttribute('aria-label')||e.innerText||e.tagName)+'').trim().replace(/\\s+/g,' ').slice(0,40);
const out=[];
for(const e of document.querySelectorAll(sel)){const r=e.getBoundingClientRect(),c=getComputedStyle(e);
if(r.width<4||r.height<4||c.visibility==='hidden'||c.display==='none'||e.disabled)continue;
const x=r.left+r.width/2,y=r.top+r.height/2;
if(!e.closest('.screen.scroll')&&(r.left<-1||r.top<-1||r.right>innerWidth+1||r.bottom>innerHeight+1)){out.push({label:name(e),by:'the screen edge',off:true,at:{x:Math.round(x),y:Math.round(y)}});continue}
if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
const t=document.elementFromPoint(x,y);if(t&&t!==e&&!e.contains(t)&&!t.contains(e))out.push({label:name(e),by:name(t),at:{x:Math.round(x),y:Math.round(y)}})}
return out})()`;

const KEYS = { d: 68, s: 83, w: 87, a: 65, " ": 32 };
async function key(browser, type, k) {
  await browser.cdp("Input.dispatchKeyEvent", { type, key: k, code: k === " " ? "Space" : `Key${k.toUpperCase()}`, windowsVirtualKeyCode: KEYS[k], nativeVirtualKeyCode: KEYS[k] });
}

/** Hold movement keys and confirm the canvas draws new frames. */
async function playCheck(browser) {
  await Bun.sleep(1500); // a 3D view may still be loading three.js
  const before = await canvasHash(browser);
  if (before === null) return { ok: false, line: "no <canvas> on /play" };
  for (const k of ["d", "s"]) await key(browser, "keyDown", k);
  await Bun.sleep(1200);
  for (const k of ["d", "s"]) await key(browser, "keyUp", k);
  const after = await canvasHash(browser);
  return before === after
    ? { ok: false, line: "the canvas did not change in 1.2 s with keys held: the loop or the drawing does not run" }
    : { ok: true, line: "the canvas changed while D and S were held" };
}

async function checkRoute(browser, base, route, n) {
  // A fresh page per screen (the query changes), so each screen starts clean.
  const url = `${base}/?check=${n}#${route}`;
  const r = { route, png: "", fail: "", console: [], failed: [], covered: [], play: null, hint: "", kind: null, images: [] };
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
    if (route === "/") r.hint = await browser.evaluate(MENU_HINT);
    if (route === "/play") r.kind = await browser.evaluate(CONTROL_KIND);
    r.images = await browser.evaluate(PAGE_IMAGES).catch(() => []);
    if (route === "/play" && !r.fail) {
      r.play = await playCheck(browser);
      if (!r.play.ok) r.fail = r.play.line;
    }
    const shot = await browser.cdp("Page.captureScreenshot", { format: "png" });
    const file = join(outDir, `${route.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._-]+/g, "_") || "index"}-${WIDTH}x${HEIGHT}.png`);
    await Bun.write(file, Buffer.from(shot.data, "base64"));
    r.png = relative(root, file);
    r.covered = await browser.evaluate(PROBE);
    const off = r.covered.filter((c) => c.off);
    if (off.length && !r.fail) r.fail = `${off.length} button(s) not fully on screen: ${off.map((c) => `"${c.label}"`).join(", ")}`;
    const after = await browser.evaluate(PAGE_STATE);
    r.console = consoleErrors(after);
    r.failed = [...new Set(after.errors.failed)];
  } catch (e) {
    r.fail = `could not check: ${e?.message ?? e}`;
  }
  return r;
}

async function main() {
  say(`check:ui  ${SIZES.map((z) => `${z.width}x${z.height}`).join(" and ")} (touch)`);
  const distState = await ensureDist(args);
  const routes = readRoutes();
  say(`dist: ${distState}; screens: ${routes.join(" ")}`);
  const base = serveDist();
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith(".png")) rmSync(join(outDir, f));
  const browser = await openBrowser({ width: WIDTH, height: HEIGHT, outDir });
  await setupPhone(browser, { width: WIDTH, height: HEIGHT });
  say(`browser: ${browser.name}`);
  say();
  const results = [];
  let n = 0;
  for (const size of SIZES) for (const route of routes) {
    if (WIDTH !== size.width || HEIGHT !== size.height || n === 0) {
      ({ width: WIDTH, height: HEIGHT } = size);
      await browser.cdp("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    }
    const r = await checkRoute(browser, base, route, n++);
    r.route = `${route} @${WIDTH}x${HEIGHT}`;
    results.push(r);
    const warn = r.console.length || r.failed.length || r.covered.length;
    say(`${r.fail ? "FAIL" : warn ? "WARN" : "OK  "} ${r.route}${r.fail ? `  ${r.fail}` : ""}${r.png ? `  ${r.png}` : ""}`);
    if (r.play?.ok) say(`     play: ${r.play.line}`);
    for (const c of r.console.slice(0, 5)) say(`     console error: ${c}`);
    for (const f of r.failed.slice(0, 5)) say(`     failed request: ${f}`);
    for (const c of r.covered.slice(0, 8)) say(`     COVERED: "${c.label}" at (${c.at.x},${c.at.y}) is under "${c.by}"`);
  }
  // The menu hint must name the control that /play draws (GAME.controls in about.ts).
  const menu = results.find((r) => r.route.startsWith("/ @"));
  const play = results.find((r) => r.route.startsWith("/play @"));
  let hintFail = "";
  if (menu && play) {
    if (!play.kind) hintFail = "no <TouchControls> on /play: the check cannot tell which control the game uses";
    else hintFail = hintProblem(play.kind, menu.hint) ?? "";
    say();
    say(`${hintFail ? "FAIL" : "OK  "} control hint: kind "${play.kind ?? "?"}", menu says "${menu.hint}"${hintFail ? `\n     ${hintFail}` : ""}`);
  }
  // The kit's sample art must not reach a published game.
  const sample = await sampleArtIn([...results.flatMap((r) => r.images), ...samplePaths(base)]);
  if (sample.length) {
    say();
    if (SAMPLE_RUN) say(`NOTE sample art: ${sample.length} kit sample file(s), expected in the kit's own sample (OMG_KIT_SAMPLE=1).`);
    else for (const line of sampleArtLines(sample)) say(line.startsWith("PLACEHOLDER") ? `WARN ${line}` : line);
  }
  const failed = results.filter((r) => r.fail).length + (hintFail ? 1 : 0);
  const warns = results.filter((r) => !r.fail && (r.console.length || r.failed.length || r.covered.length)).length + (sample.length && !SAMPLE_RUN ? 1 : 0);
  say();
  say(`RESULT: ${failed ? "FAIL" : warns ? "WARN" : "PASS"}  screens=${results.length} failed=${failed} with-warnings=${warns}`);
  if (failed || warns) say("Open the PNGs, fix each item, and run `bun run check:ui` again.");
  return failed ? 1 : 0;
}

let code = 1;
try { code = await main(); } catch (e) { say(`check:ui could not run: ${e?.message ?? e}`); }
await cleanup();
process.exit(code);
