#!/usr/bin/env node
// Renders designed App Store screenshot frames from raw simulator captures.
//
// Usage:
//   node render.mjs [--src <dir-with-iphone-6.9in-and-ipad-13in-subdirs>] [--out <output-dir>]
//                   [--creative-only] [--safe-area]
//   --creative-only  render only the header and search results assets
//   --safe-area      also draw Apple's art safe area (review copies, never upload)
//
// Defaults to the paths used for the omg.dev App Store listing:
//   --src /home/dev/omg-appstore-screenshots
//   --out /home/dev/omg-appstore-screenshots/designed
//
// Source captures are expected at exactly the target resolution already
// (1320x2868 for iphone-6.9in, 2064x2752 for ipad-13in) -- that's what
// Apple requires and what the app's own screenshot tooling produces. Re-run
// this any time captures are retaken; nothing here is hand-tuned per image.
//
// It also renders the App Store creative assets (product page header and
// search results image, iOS 27+) into <out>/creative/ as JPEG -- see
// CREATIVE_ASSETS in config.mjs.
//
// Pipeline: HTML/CSS composited to PNG via headless Chromium (Playwright),
// at the exact target pixel dimensions. No upscaling: every source capture
// is already exactly the target resolution, so the device image is placed
// at 1:1 scale and only cropped (never stretched) -- see README.md for why
// the crop is always from the top.
//
// Setup (first run):
//   npm install
//   npx playwright install chromium   # skip if already cached locally

import { chromium } from 'playwright';
import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS, CAPTIONS, BUCKETS, COLORS, CREATIVE_ART, CREATIVE_ASSETS, CREATIVE_SOURCE_BUCKET } from './config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, 'fonts');

function parseArgs(argv) {
  const args = { src: null, out: null, safeArea: false, creativeOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src') args.src = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--safe-area') args.safeArea = true;
    else if (argv[i] === '--creative-only') args.creativeOnly = true;
  }
  return args;
}

function fileUrl(p) {
  return 'file://' + path.resolve(p);
}

function buildHtml({ cfg, captionText, imagePath }) {
  const { width, height, headlineZoneHeight, fontSize, sideMargin, topPadding, cornerRadius } = cfg;
  const interBold = fileUrl(path.join(FONTS_DIR, 'InterDisplay-Bold.woff2'));

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'InterDisplay';
    src: url('${interBold}') format('woff2');
    font-weight: 700;
    font-display: block;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: ${COLORS.background};
  }
  .frame {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    background: ${COLORS.background};
  }
  .headline {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: ${headlineZoneHeight}px;
    display: flex;
    align-items: flex-end;
    padding: ${topPadding}px ${sideMargin}px 40px;
  }
  .headline span {
    font-family: 'InterDisplay', sans-serif;
    font-weight: 700;
    font-size: ${fontSize}px;
    line-height: 1.06;
    letter-spacing: -0.02em;
    color: ${COLORS.text};
  }
  .device {
    position: absolute;
    top: ${headlineZoneHeight}px;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
    border-top-left-radius: ${cornerRadius}px;
    border-top-right-radius: ${cornerRadius}px;
    box-shadow: 0 -1px 0 rgba(0,0,0,0.06);
  }
  .device img {
    display: block;
    width: 100%;
    height: auto;
  }
</style>
</head>
<body>
  <div class="frame">
    <div class="headline"><span>${captionText}</span></div>
    <div class="device"><img src="${fileUrl(imagePath)}"></div>
  </div>
</body>
</html>`;
}

// The omg.dev mark (web/src/components/omg-brand-mark.tsx): a disc with a
// bite out of the upper right. The bite is a mask, so the backdrop shows.
const OMG_MARK_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <mask id="bite"><rect width="100" height="100" fill="white"/><circle cx="71" cy="29" r="14" fill="black"/></mask>
  <circle cx="50" cy="50" r="44" fill="${COLORS.brand}" mask="url(#bite)"/>
</svg>`;

// Review overlay: Apple's safe area (green), the layout box (orange) and,
// for the header, the iPhone status bar and floating buttons.
function debugOverlay(cfg) {
  let html = '<div class="dbg safe-area"></div><div class="dbg content"></div>';
  if (cfg.iphone) {
    html += '<div class="dbg status"></div>';
    for (const b of cfg.iphone.buttons) {
      html += `<div class="dbg button" style="left:${b.x - b.r}px;top:${b.y - b.r}px;width:${2 * b.r}px;height:${2 * b.r}px"></div>`;
    }
  }
  return html;
}

function within(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

function buildCreativeHtml({ cfg, backdropPath, figurePath, phonePath, showSafeArea }) {
  const { width, height, safeArea, contentBox: box, iphone, headline, fontSize, markSize, figureHeight, phone } = cfg;
  const markHtml = markSize ? `<div class="mark">${OMG_MARK_SVG}</div>` : '';
  const crop = CREATIVE_ART.figureCrop;
  const k = figureHeight / crop.h;
  const figureHtml = `<div class="figure" style="width:${Math.round(crop.w * k)}px;height:${figureHeight}px"><img src="${fileUrl(figurePath)}" style="position:absolute;left:${-Math.round(crop.x * k)}px;top:${-Math.round(crop.y * k)}px;height:${Math.round(CREATIVE_ART.figureSourceHeight * k)}px"></div>`;
  const interBold = fileUrl(path.join(FONTS_DIR, 'InterDisplay-Bold.woff2'));
  const headlineHtml = headline.split('\n').map((l) => `<span>${l}</span>`).join('<br>');
  const phoneHtml = phone
    ? `<div class="phone" style="width:${phone.width}px;height:${Math.round((phone.sourceCropHeight * phone.width) / 1320)}px;border-radius:${phone.cornerRadius}px"><img src="${fileUrl(phonePath)}"></div>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'InterDisplay';
    src: url('${interBold}') format('woff2');
    font-weight: 700;
    font-display: block;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${COLORS.paper}; }
  .backdrop { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; }
  .safe {
    position: absolute;
    left: ${box.x}px; top: ${box.y}px; width: ${box.w}px; height: ${box.h}px;
    display: flex; align-items: center; justify-content: center; gap: ${Math.round(box.w * 0.04)}px;
  }
  .words { display: flex; flex-direction: column; gap: ${Math.round(fontSize * 0.45)}px; }
  .mark { width: ${markSize}px; height: ${markSize}px; }
  .mark svg { width: 100%; height: 100%; display: block; }
  .headline {
    font-family: 'InterDisplay', sans-serif; font-weight: 700;
    font-size: ${fontSize}px; line-height: 1.08; letter-spacing: -0.02em;
    color: ${COLORS.ink}; white-space: nowrap;
  }
  /* The figure rests on the hill: its grass patch sits on the safe area's
     bottom edge, which is where the backdrop's hill crest runs. */
  .figure { position: relative; overflow: hidden; flex: 0 0 auto; align-self: flex-end; }
  .left { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start;
    align-self: stretch; }
  .left .figure { align-self: flex-start; }
  .phone { flex: 0 0 auto; overflow: hidden; background: #fff;
    box-shadow: 0 30px 80px rgba(60, 50, 30, 0.18), 0 0 0 2px rgba(60, 50, 30, 0.08); }
  .phone img { display: block; width: 100%; height: auto; }
  .dbg { position: absolute; pointer-events: none; }
  .dbg.safe-area { left: ${safeArea.x}px; top: ${safeArea.y}px; width: ${safeArea.w}px; height: ${safeArea.h}px; outline: 6px dashed #00c853; }
  .dbg.content { left: ${box.x}px; top: ${box.y}px; width: ${box.w}px; height: ${box.h}px; outline: 4px dotted #ff9100; }
  .dbg.status { left: 0; right: 0; top: 0; height: ${iphone ? iphone.statusBarBottom : 0}px; background: rgba(0,0,0,0.12); }
  .dbg.button { border-radius: 50%; background: rgba(255,255,255,0.85); box-shadow: 0 0 0 3px rgba(0,0,0,0.25); }
</style>
</head>
<body>
  <img class="backdrop" src="${fileUrl(backdropPath)}">
  <div class="safe">
    ${phone
      ? `<div class="left"><div class="words">${markHtml}<div class="headline">${headlineHtml}</div></div>${figureHtml}</div>${phoneHtml}`
      : `<div class="words">${markHtml}<div class="headline">${headlineHtml}</div></div>${figureHtml}`}
  </div>
  ${showSafeArea ? debugOverlay(cfg) : ''}
</body>
</html>`;
}

async function renderCreativeAssets({ browser, srcDir, outDir, tmpDir, showSafeArea }) {
  const creativeOutDir = path.join(outDir, 'creative');
  await mkdir(creativeOutDir, { recursive: true });
  const backdropPath = path.join(__dirname, CREATIVE_ART.backdrop);
  const figurePath = path.join(__dirname, CREATIVE_ART.figure);
  for (const p of [backdropPath, figurePath]) {
    if (!existsSync(p)) throw new Error(`Missing creative art: ${p}`);
  }

  for (const [name, cfg] of Object.entries(CREATIVE_ASSETS)) {
    if (cfg.iphone) {
      const box = cfg.contentBox;
      if (!within(box, cfg.safeArea) || !within(box, cfg.iphone.view)) {
        throw new Error(`${name}: contentBox must sit inside the safe area and the iPhone view`);
      }
      if (box.y < cfg.iphone.statusBarBottom) throw new Error(`${name}: contentBox runs under the status bar`);
      for (const b of cfg.iphone.buttons) {
        const nx = Math.max(box.x, Math.min(b.x, box.x + box.w));
        const ny = Math.max(box.y, Math.min(b.y, box.y + box.h));
        if ((nx - b.x) ** 2 + (ny - b.y) ** 2 < b.r ** 2) throw new Error(`${name}: contentBox runs under an iPhone button`);
      }
    }
    const phonePath = cfg.phone ? path.join(srcDir, CREATIVE_SOURCE_BUCKET, `${cfg.phone.stem}.png`) : null;
    if (phonePath && !existsSync(phonePath)) throw new Error(`Missing source capture: ${phonePath}`);

    const page = await browser.newPage({
      viewport: { width: cfg.width, height: cfg.height },
      deviceScaleFactor: 1,
    });
    const htmlPath = path.join(tmpDir, `creative-${name}.html`);
    await writeFile(htmlPath, buildCreativeHtml({ cfg, backdropPath, figurePath, phonePath, showSafeArea }), 'utf8');
    await page.goto(fileUrl(htmlPath), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    const size = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));
    if (size.w !== cfg.width || size.h !== cfg.height) {
      throw new Error(`Viewport mismatch for ${name}: expected ${cfg.width}x${cfg.height}, got ${size.w}x${size.h}`);
    }
    // Everything that carries meaning must stay inside the content box.
    const overflow = await page.evaluate(({ x, y, w, h }) => {
      const out = [];
      for (const el of document.querySelectorAll('.safe > *, .words, .mark, .headline, .figure, .phone')) {
        const r = el.getBoundingClientRect();
        if (r.left < x - 1 || r.top < y - 1 || r.right > x + w + 1 || r.bottom > y + h + 1) {
          out.push(`${el.className} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return out;
    }, cfg.contentBox);
    if (overflow.length) {
      throw new Error(`${name}: content leaves its content box: ${overflow.join('; ')}`);
    }

    // JPEG, not PNG: Apple refuses creative assets with an alpha channel, and
    // Chromium writes PNG screenshots as RGBA even when every pixel is opaque.
    const suffix = showSafeArea ? '.safe-area' : '';
    const outPath = path.join(creativeOutDir, `${name}${suffix}.jpg`);
    await page.screenshot({ path: outPath, type: 'jpeg', quality: 92 });
    if (showSafeArea && cfg.iphone) {
      // What an iPhone in portrait shows of the header (review only).
      const v = cfg.iphone.view;
      const phonePath = path.join(creativeOutDir, `${name}.iphone-view.jpg`);
      await page.screenshot({ path: phonePath, type: 'jpeg', quality: 92, clip: { x: v.x, y: v.y, width: v.w, height: v.h } });
      console.log(`Rendered ${phonePath} (${v.w}x${v.h})`);
    }
    await page.close();
    console.log(`Rendered ${outPath} (${cfg.width}x${cfg.height})`);
  }
}

async function main() {
  const { src, out, safeArea, creativeOnly } = parseArgs(process.argv.slice(2));
  const srcDir = src ? path.resolve(src) : '/home/dev/omg-appstore-screenshots';
  const outDir = out ? path.resolve(out) : '/home/dev/omg-appstore-screenshots/designed';

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'appstore-frame-'));
  const browser = await chromium.launch();
  try {
    for (const [bucket, order] of creativeOnly ? [] : Object.entries(BUCKETS)) {
      const cfg = PLATFORMS[bucket];
      if (!cfg) throw new Error(`No platform config for bucket ${bucket}`);
      const bucketOutDir = path.join(outDir, bucket);
      await mkdir(bucketOutDir, { recursive: true });

      const page = await browser.newPage({
        viewport: { width: cfg.width, height: cfg.height },
        deviceScaleFactor: 1,
      });

      for (let i = 0; i < order.length; i++) {
        const stem = order[i];
        const imagePath = path.join(srcDir, bucket, `${stem}.png`);
        if (!existsSync(imagePath)) {
          throw new Error(`Missing source capture: ${imagePath}`);
        }
        const captionText = CAPTIONS[stem];
        if (!captionText) throw new Error(`No caption configured for ${stem}`);

        const html = buildHtml({ cfg, captionText, imagePath });
        // Write to a temp .html file and navigate to it via file:// so the
        // page's origin is file:// too -- local <img src="file://..."> is
        // blocked when the document origin is about:blank (page.setContent()).
        const htmlPath = path.join(tmpDir, `${bucket}-${stem}.html`);
        await writeFile(htmlPath, html, 'utf8');
        await page.goto(fileUrl(htmlPath), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);

        const baseName = stem.replace(/^\d+-/, '');
        const outPath = path.join(bucketOutDir, `${String(i + 1).padStart(2, '0')}-${baseName}.png`);
        await page.screenshot({ path: outPath, type: 'png' });

        const size = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));
        if (size.w !== cfg.width || size.h !== cfg.height) {
          throw new Error(`Viewport mismatch for ${outPath}: expected ${cfg.width}x${cfg.height}, got ${size.w}x${size.h}`);
        }
        console.log(`Rendered ${outPath} (${cfg.width}x${cfg.height})`);
      }

      await page.close();
    }

    await renderCreativeAssets({ browser, srcDir, outDir, tmpDir, showSafeArea: safeArea });
  } finally {
    await browser.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
