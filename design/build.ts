// Assemble the design-system upload bundle.
//
// Each card in cards/ is a full HTML preview whose first line is the
// `<!-- @dsCard ... -->` marker the Design System pane indexes. The shared
// token sheet is kept once in tokens.css and inlined here so every uploaded
// card is self-contained.
import { mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";

const root = import.meta.dir;
const cardsDir = join(root, "cards");
const distDir = join(root, "dist");

const tokens = await Bun.file(join(root, "tokens.css")).text();
const styleBlock = `<style>\n${tokens}\n</style>`;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let count = 0;
for await (const file of walk(cardsDir)) {
  const rel = file.slice(cardsDir.length + 1);
  const src = await Bun.file(file).text();
  if (file.endsWith(".html")) {
    if (!src.startsWith("<!-- @dsCard")) {
      throw new Error(`${rel}: first line must be the @dsCard marker`);
    }
    if (!src.includes("<!-- @tokens -->")) {
      throw new Error(`${rel}: missing <!-- @tokens --> placeholder`);
    }
  }
  const out = src.replace("<!-- @tokens -->", styleBlock);
  const dest = join(distDir, rel);
  await mkdir(dirname(dest), { recursive: true });
  await Bun.write(dest, out);
  count++;
}
console.log(`built ${count} files -> ${distDir}`);
