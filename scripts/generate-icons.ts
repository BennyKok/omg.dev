/** Generate app tiles and the separate, quieter coding-agent avatar.
 * bun run icons [--check]
 * --check compares decoded pixels and validates the native alpha contracts.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dir, "..");
const check = process.argv.includes("--check");
const source = await readFile(resolve(root, "web/public/icon.svg"), "utf8");
const avatar = await readFile(resolve(root, "web/public/agent-omg.svg"), "utf8");

function variant({ scale = 1, transparent = false, monochrome = false } = {}): string {
  let svg = source;
  if (transparent) svg = svg.replace(/\s*<rect id="background"[^>]+\/>/, "");
  if (monochrome) svg = svg.replace('fill="#FF5530"', 'fill="#FFFFFF"');
  if (scale !== 1) {
    const inset = +(50 * (1 - scale)).toFixed(3);
    svg = svg.replace('<g id="mark"', `<g transform="translate(${inset} ${inset}) scale(${scale})"><g id="mark"`)
      .replace("</g>\n</svg>", "</g></g>\n</svg>");
  }
  return svg;
}

async function svgOutput(file: string, svg: string) {
  const path = resolve(root, file);
  if (check) {
    if (await readFile(path, "utf8") !== svg) throw new Error(`Stale app SVG: ${file}`);
  } else await writeFile(path, svg);
}

async function pngOutput(file: string, svg: string, size: number, opaque = true) {
  let renderer = sharp(Buffer.from(svg), { density: 384 }).resize(size, size);
  if (opaque) renderer = renderer.flatten({ background: "#FFFFFF" });
  const png = await renderer.png().toBuffer();
  const path = resolve(root, file);
  if (check) {
    const expected = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const image = sharp(await readFile(path));
    const metadata = await image.metadata();
    const actual = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (metadata.width !== size || metadata.height !== size || metadata.hasAlpha === opaque || !actual.data.equals(expected.data)) {
      throw new Error(`Stale app PNG or wrong alpha: ${file}`);
    }
  } else await writeFile(path, png);
}

const safe = variant({ scale: .8 });
// Browser tab favicon: no white tile, mark fills the square. A white square
// with a small disc reads as a broken image in a dark tab strip.
await svgOutput("web/public/icon-small.svg", variant({ scale: 1.3, transparent: true }));
await svgOutput("web/public/icon-maskable.svg", safe);
for (const [file, size] of [
  ["web/public/icon-192.png", 192],
  ["web/public/icon-512.png", 512],
  ["web/public/apple-touch-icon.png", 180],
  ["docs/images/omg-icon.png", 192],
  ["mobile/assets/icon.png", 1024],
  ["mobile/assets/favicon.png", 96],
] as const) await pngOutput(file, source, size);
await pngOutput("web/public/icon-maskable-512.png", safe, 512);
// README mark: no white tile, which shows as a hard square on GitHub's dark
// theme. The eye is painted white so it reads the same on light and dark.
const readmeMark = variant({ scale: 1.3, transparent: true })
  .replace(' mask="url(#disc)"/>', ' mask="url(#disc)"/>\n    <circle cx="71" cy="29" r="14" fill="#FFFFFF"/>');
await pngOutput("docs/images/omg-mark.png", readmeMark, 192, false);
await pngOutput("mobile/assets/splash-icon.png", variant({ transparent: true }), 1024, false);
await pngOutput("mobile/assets/android-icon-foreground.png", variant({ scale: .66, transparent: true }), 1024, false);
await pngOutput("mobile/assets/android-icon-monochrome.png", variant({ scale: .66, transparent: true, monochrome: true }), 1024, false);
// Android status icons use an alpha silhouette. A white app tile becomes a square.
await pngOutput("mobile/assets/notification-icon.png", variant({ transparent: true, monochrome: true }), 96, false);
for (const scale of [1, 2, 3]) {
  await pngOutput(`mobile/assets/agents/agent-omg${scale === 1 ? "" : `@${scale}x`}.png`, avatar, 32 * scale, false);
}
console.log(`App tile, platform masks and avatar ${check ? "verified" : "generated"}`);
