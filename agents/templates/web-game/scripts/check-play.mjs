#!/usr/bin/env bun
// Play self-check: play one round like a player on a phone, headless, with no
// desktop. Run it before you publish, and again on the live link after.
//
//   bun run check:play                          build dist when stale, serve it, play
//   bun run check:play -- --url http://127.0.0.1:5174      the dev server
//   bun run check:play -- --url https://my-game.omgs.app   the live link
//   bun run check:play -- --rebuild | --no-build
//
// At 390x844 with touch it opens the menu, taps Play, drives the control that
// /play draws (drag, stick, dpad, steer or buttons, read from the page, so it
// works for any game made from the kit), confirms the control reached the
// game input and the canvas changed, pauses and resumes, then runs the game
// faster (test mode, `?test=1`) until the results screen shows. It saves
// screenshots in .omg/play-check/.
//
// Exit code 1 when: the menu or Play does not work, the control does not
// reach the input, the canvas does not change, Resume does not close the
// pause, no results screen within 45 s at 10x speed, a console error, the
// menu hint names another control, or the page still shows the kit's sample
// art (icons, share image, hero, score icon). The kit's own sample sets
// OMG_KIT_SAMPLE=1 to accept its sample art.
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CONTROL_KIND, ERROR_TEXT, MENU_HINT, PAGE_IMAGES, PAGE_STATE, SAMPLE_RUN, canvasHash, cleanup, consoleErrors, ensureDist, hintProblem,
  openBrowser, root, sampleArtIn, sampleArtLines, samplePaths, say, serveDist, setupPhone,
} from "./kit-check.mjs";

const argv = process.argv.slice(2);
const args = new Set(argv);
const urlArg = argv.includes("--url") ? argv[argv.indexOf("--url") + 1] : null;
const outDir = join(root, ".omg", "play-check");
const SIZE = { width: 390, height: 844 };
const ROUND_LIMIT_S = 45;
const TEST_SPEED = 10;

const fails = [];
const warns = [];
const ok = (line) => say(`OK   ${line}`);
const fail = (line) => { fails.push(line); say(`FAIL ${line}`); };
const warn = (line) => { warns.push(line); say(`WARN ${line}`); };

let browser;
let shotN = 0;
async function shot(name) {
  const s = await browser.cdp("Page.captureScreenshot", { format: "png" });
  const file = join(outDir, `${String(++shotN).padStart(2, "0")}-${name}.png`);
  await Bun.write(file, Buffer.from(s.data, "base64"));
  say(`     screenshot ${relative(root, file)}`);
  return file;
}

const evaluate = (e) => browser.evaluate(e);
const rectOf = (selector) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return null;return {x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2}})()`);
const hash = () => evaluate("location.hash");

async function waitFor(expression, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression).catch(() => false)) return true;
    await Bun.sleep(100);
  }
  return false;
}

// Touch fingers. `points` is the full list of fingers down after the event.
async function touches(type, points) {
  await browser.cdp("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });
}
async function tap(selector) {
  const r = await rectOf(selector);
  if (!r) return false;
  await touches("touchStart", [{ x: r.cx, y: r.cy, id: 1 }]);
  await Bun.sleep(60);
  await touches("touchEnd", []);
  return true;
}
/** Slide finger `id` from `from` to `to` in small steps, with `others` still down. */
async function slide(id, from, to, ms, others = []) {
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const p = { id, x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    await touches("touchMove", [...others, p]);
    await Bun.sleep(ms / steps);
  }
}

// The live game input (test mode exposes it as window.__omgTest.input).
const INPUT = `(()=>{const t=window.__omgTest;const i=t&&t.input&&t.input.p1;if(!i)return null;return {sx:i.stick.x,sy:i.stick.y,drag:i.drag,held:i.held}})()`;
const readInput = () => evaluate(INPUT).catch(() => null);
const hudText = () => evaluate(`(()=>{const h=document.querySelector('.hud');return h?h.innerText.replace(/\\s+/g,' ').trim():''})()`);

/** Drive the control for about 3 s. Returns what the game input showed, as lines that must hold. */
async function drive(kind) {
  const checks = [];
  const button = await rectOf(".hold-button.action");
  const pressButton = async (others) => {
    if (!button) return null;
    await touches("touchStart", [...others, { id: 9, x: button.cx, y: button.cy }]);
    await Bun.sleep(120);
    const i = await readInput();
    await touches("touchEnd", others);
    return Boolean(i?.held?.a || i?.held?.b);
  };
  if (kind === "drag") {
    const f = await rectOf(".drag-field");
    if (!f) return [{ ok: false, line: 'kind "drag" but no .drag-field on /play' }];
    const start = { x: f.cx, y: f.y + f.h * 0.6 };
    const right = { x: start.x + 110, y: start.y - 40 };
    const left = { x: start.x - 110, y: start.y + 40 };
    await shot("drag-before");
    await touches("touchStart", [{ id: 1, ...start }]);
    await slide(1, start, right, 300);
    await Bun.sleep(500);
    const a = await readInput();
    await shot("drag-right");
    const both = await pressButton([{ id: 1, ...right }]);
    await slide(1, right, left, 500);
    await Bun.sleep(500);
    const b = await readInput();
    await shot("drag-left");
    await touches("touchEnd", []);
    await Bun.sleep(100);
    const c = await readInput();
    const moved = (i, dir) => i && ((dir > 0 ? i.sx > 0.3 : i.sx < -0.3) || (i.drag && (dir > 0 ? i.drag.x > 0.55 : i.drag.x < 0.45)));
    checks.push({ ok: moved(a, 1), line: `drag right reached the input (stick x ${a?.sx?.toFixed(2)}, target ${a?.drag ? a.drag.x.toFixed(2) : "none"})` });
    checks.push({ ok: moved(b, -1), line: `drag left reached the input (stick x ${b?.sx?.toFixed(2)}, target ${b?.drag ? b.drag.x.toFixed(2) : "none"})` });
    checks.push({ ok: c && c.sx === 0 && c.sy === 0 && !c.drag, line: "lifting the finger stops the drag" });
    if (both !== null) checks.push({ ok: both, line: "an action button works while a finger drags (multi-touch)" });
  } else if (kind === "stick") {
    const s = await rectOf(".stick-base");
    if (!s) return [{ ok: false, line: 'kind "stick" but no stick on /play' }];
    const c = { x: s.cx, y: s.cy };
    await touches("touchStart", [{ id: 1, ...c }]);
    await slide(1, c, { x: c.x + 50, y: c.y }, 200);
    await Bun.sleep(900);
    const a = await readInput();
    await shot("stick-right");
    const both = await pressButton([{ id: 1, x: c.x + 50, y: c.y }]);
    await slide(1, { x: c.x + 50, y: c.y }, { x: c.x - 30, y: c.y - 40 }, 200);
    await Bun.sleep(900);
    const b = await readInput();
    await touches("touchEnd", []);
    checks.push({ ok: a && a.sx > 0.3, line: `stick right reached the input (x ${a?.sx?.toFixed(2)})` });
    checks.push({ ok: b && b.sy < -0.3, line: `stick up reached the input (y ${b?.sy?.toFixed(2)})` });
    if (both !== null) checks.push({ ok: both, line: "an action button works while a finger holds the stick (multi-touch)" });
  } else if (kind === "steer" || kind === "dpad") {
    for (const dir of kind === "steer" ? ["right", "left"] : ["right", "up"]) {
      const r = await rectOf(`.hold-button[aria-label="${dir}"]`);
      if (!r) { checks.push({ ok: false, line: `kind "${kind}" but no ${dir} button on /play` }); continue; }
      await touches("touchStart", [{ id: 1, x: r.cx, y: r.cy }]);
      await Bun.sleep(1200);
      const i = await readInput();
      if (dir === "right") await shot(`${kind}-right`);
      await touches("touchEnd", []);
      checks.push({ ok: Boolean(i?.held?.[dir]), line: `holding ${dir} reached the input` });
    }
  } else if (kind === "buttons") {
    if (!button) return [{ ok: false, line: 'kind "buttons" but no action button on /play' }];
    let any = false;
    for (let n = 0; n < 6; n++) { any = (await pressButton([])) || any; await Bun.sleep(350); }
    await shot("buttons");
    checks.push({ ok: any, line: "tapping the action button reached the input" });
  } else {
    checks.push({ ok: false, line: `unknown control kind "${kind}"` });
  }
  return checks;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith(".png")) rmSync(join(outDir, f));
  let base;
  if (urlArg) {
    base = urlArg.replace(/[?#].*$/, "").replace(/\/+$/, "");
    say(`check:play  ${base}  ${SIZE.width}x${SIZE.height} (touch)`);
  } else {
    const state = await ensureDist(args);
    base = serveDist();
    say(`check:play  dist: ${state}  ${SIZE.width}x${SIZE.height} (touch)`);
  }
  browser = await openBrowser({ ...SIZE, outDir });
  await setupPhone(browser, SIZE);
  say(`browser: ${browser.name}`);
  say();

  // 1. Menu.
  await browser.navigate(`${base}/?test=1#/`);
  if (!(await waitFor(`!!document.querySelector('.menu-actions .game-button')`, 15_000))) {
    fail("the menu did not show a button within 15 s");
    await shot("menu");
    return;
  }
  await Bun.sleep(800);
  const images = await evaluate(PAGE_IMAGES).catch(() => []);
  const hint = await evaluate(MENU_HINT);
  ok(`menu shows (hint: "${hint}")`);
  await shot("menu");

  // 2. Play.
  await tap(".menu-actions .game-button.primary");
  if (!(await waitFor(`location.hash.startsWith('#/play')`, 3000))) {
    await evaluate(`document.querySelector('.menu-actions .game-button.primary').click()`);
    if (await waitFor(`location.hash.startsWith('#/play')`, 3000)) warn("a touch tap on Play did nothing; a click worked");
  }
  if (!(await waitFor(`location.hash.startsWith('#/play') && !!document.querySelector('main.play[data-ready]')`, 15_000))) {
    fail(`Play did not open a ready game screen (page is at ${await hash()})`);
    await shot("play");
    return;
  }
  ok("Play opens the game");
  await Bun.sleep(700);
  const kind = await evaluate(CONTROL_KIND);
  if (!kind) fail("no <TouchControls> on /play: render it with the kind from GAME.controls.kind (the control cannot be tested)");
  else {
    const hintFail = hintProblem(kind, hint);
    if (hintFail) fail(hintFail);
    else ok(`control "${kind}" matches the menu hint`);
  }
  images.push(...(await evaluate(PAGE_IMAGES).catch(() => [])));
  const startCanvas = await canvasHash(browser);
  const startHud = await hudText();
  await shot("play-start");

  // 3. Drive the control.
  if (kind) for (const c of await drive(kind)) (c.ok ? ok : fail)(c.line);
  const afterCanvas = await canvasHash(browser);
  const afterHud = await hudText();
  if (startCanvas === null) fail("no <canvas> on /play");
  else if (startCanvas === afterCanvas) fail("the canvas did not change in 3 s of play");
  else ok(kind ? "the canvas changed while the control was driven" : "the canvas changed during play");
  if (startHud !== afterHud) ok(`the HUD changed ("${startHud}" -> "${afterHud}")`);
  else say(`     the HUD did not change ("${afterHud}"); fine for a game that scores later`);

  // 4. Pause and resume.
  if (await tap(".pause-button")) {
    if (await waitFor(`!!document.querySelector('[role=dialog][aria-label=Paused]')`, 2000)) {
      await Bun.sleep(600);
      const p1 = await canvasHash(browser);
      await Bun.sleep(700);
      const p2 = await canvasHash(browser);
      await shot("paused");
      if (p1 === p2) ok("Pause stops the game");
      else warn("the canvas kept changing while paused: does the game stop on Pause?");
      await tap("[role=dialog][aria-label=Paused] .game-button.primary");
      if (await waitFor(`!document.querySelector('[role=dialog][aria-label=Paused]')`, 2000)) {
        const r1 = await canvasHash(browser);
        await Bun.sleep(800);
        if (r1 !== (await canvasHash(browser))) ok("Resume continues the game");
        else warn("the canvas did not change for 0.8 s after Resume");
      } else fail("Resume did not close the pause screen");
    } else fail("the pause button did not open the pause screen");
  } else fail("no pause button (.pause-button) on /play");

  // 5. Results: let the round run out at test speed.
  await evaluate(`window.__omgTest && (window.__omgTest.speed = ${TEST_SPEED})`);
  const t0 = Date.now();
  const ended = await waitFor(`location.hash.startsWith('#/results')`, ROUND_LIMIT_S * 1000);
  await evaluate(`window.__omgTest && (window.__omgTest.speed = 1)`);
  if (!ended) {
    fail(`the round did not end within ${ROUND_LIMIT_S} s at ${TEST_SPEED}x speed with no input. Every round must end on its own: a clock, lives, or falling items`);
    await shot("no-results");
  } else {
    await Bun.sleep(900);
    const state = await evaluate(PAGE_STATE);
    const text = state.text.trim();
    if (!text || ERROR_TEXT.test(text.slice(0, 2000))) fail(`the results screen is blank or shows an error: "${text.slice(0, 80)}"`);
    else ok(`the round ended and the results screen shows (${((Date.now() - t0) / 1000).toFixed(1)} s at ${TEST_SPEED}x)`);
    images.push(...(await evaluate(PAGE_IMAGES).catch(() => [])));
    await shot("results");
  }

  // 6. Console errors and failed requests over the whole round.
  const final = await evaluate(PAGE_STATE);
  const errors = consoleErrors(final);
  if (errors.length) for (const e of errors.slice(0, 5)) fail(`console error: ${e}`);
  else ok("no console errors");
  for (const f of [...new Set(final.errors.failed)].slice(0, 5)) warn(`failed request: ${f}`);

  // 7. The kit's sample art.
  const sample = await sampleArtIn([...images, ...samplePaths(base)]);
  if (!sample.length) ok("no kit sample art on the page");
  else if (SAMPLE_RUN) say(`NOTE sample art: ${sample.length} kit sample file(s), expected in the kit's own sample (OMG_KIT_SAMPLE=1)`);
  else {
    const [head, ...rest] = sampleArtLines(sample);
    fail(head);
    for (const line of rest) say(line);
  }
}

let code = 1;
try {
  await main();
  say();
  say(`RESULT: ${fails.length ? "FAIL" : warns.length ? "WARN" : "PASS"}  failed=${fails.length} warnings=${warns.length}  screenshots: ${relative(root, outDir)}/`);
  if (fails.length) say("Fix each FAIL, look at the screenshots, and run `bun run check:play` again.");
  code = fails.length ? 1 : 0;
} catch (e) {
  say(`check:play could not run: ${e?.message ?? e}`);
}
await cleanup();
process.exit(code);
