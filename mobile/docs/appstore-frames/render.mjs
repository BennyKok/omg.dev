#!/usr/bin/env node
// Renders designed App Store screenshot frames from raw simulator captures.
//
// Usage:
//   node render.mjs [--src <dir-with-iphone-6.9in-and-ipad-13in-subdirs>] [--out <output-dir>]
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
import { PLATFORMS, CAPTIONS, BUCKETS, COLORS } from './config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, 'fonts');

function parseArgs(argv) {
  const args = { src: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src') args.src = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
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

async function main() {
  const { src, out } = parseArgs(process.argv.slice(2));
  const srcDir = src ? path.resolve(src) : '/home/dev/omg-appstore-screenshots';
  const outDir = out ? path.resolve(out) : '/home/dev/omg-appstore-screenshots/designed';

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'appstore-frame-'));
  const browser = await chromium.launch();
  try {
    for (const [bucket, order] of Object.entries(BUCKETS)) {
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
  } finally {
    await browser.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
