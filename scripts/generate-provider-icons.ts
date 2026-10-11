/** Web geometry is the source of truth for native provider marks.
 * bun scripts/generate-provider-icons.ts [--check]
 * --check compares decoded pixels, so PNG metadata does not affect the result.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { PROVIDER_PATHS } from "../web/src/lib/model-provider-icon-paths";

const root = resolve(import.meta.dir, "..");
const check = process.argv.includes("--check");
for (const [provider, path] of Object.entries(PROVIDER_PATHS)) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="${path}"/></svg>`);
  for (const scale of [1, 2, 3]) {
    const size = 32 * scale;
    const file = resolve(root, `mobile/assets/providers/provider-${provider}${scale === 1 ? "" : `@${scale}x`}.png`);
    const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
    if (check) {
      const expected = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const actual = await sharp(await readFile(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (actual.info.width !== size || actual.info.height !== size || !actual.data.equals(expected.data)) {
        throw new Error(`Provider asset differs from web geometry: ${file}`);
      }
    } else {
      await writeFile(file, png);
    }
  }
}
console.log(`${Object.keys(PROVIDER_PATHS).length} provider marks ${check ? "verified" : "generated"} at 1x, 2x and 3x`);
