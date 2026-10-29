import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { mount, type Mounted } from "../../test-support/render";

const { StreamdownResponse } = await import("./streamdown-response");

// patches/streamdown@<version>.patch: a finished block reuses its parsed tree,
// so a transcript that mounts again (every session switch) does not parse
// every visible block again. Streamdown hands each component the tree node it
// came from, which makes the reuse observable without timing anything.
//
// The cache keeps the most recently used trees: up to 500 per processor and
// 1,000,000 characters of their source (a tree costs about 35 bytes per source
// character), and never a single source longer than that.

let ui: Mounted;
let seen: unknown[];

beforeAll(() => process.chdir(import.meta.dir));
beforeEach(() => {
  ui = mount();
  seen = [];
});
afterEach(() => ui.cleanup());

function Paragraph({ node, children }: { node?: unknown; children?: ReactNode }) {
  seen.push(node);
  return <p>{children}</p>;
}
const components = { p: Paragraph };

async function show(text: string, extra: Record<string, unknown> = {}) {
  ui.render(
    <StreamdownResponse components={components} {...extra}>
      {text}
    </StreamdownResponse>,
  );
  await ui.flushAsync();
  const html = ui.host.innerHTML;
  ui.render(null);
  await ui.flushAsync();
  return html;
}

describe("Streamdown parse cache", () => {
  test("a block mounted again reuses its parsed tree and renders the same", async () => {
    const text = "A paragraph with **bold** text and a [link](https://example.com).";
    const first = await show(text);
    const second = await show(text);
    expect(second).toBe(first);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  });

  test("different text is parsed on its own", async () => {
    const first = await show("First paragraph.");
    const second = await show("Second paragraph.");
    expect(second).not.toBe(first);
    expect(second).toContain("Second paragraph.");
    expect(seen[1]).not.toBe(seen[0]);
  });

  test("a streaming, animated block is parsed every time", async () => {
    const streaming = { mode: "streaming", animated: true, isAnimating: true };
    await show("Still **writ", streaming);
    await show("Still **writ", streaming);
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
  });

  test("the patch targets the installed Streamdown", () => {
    // bun applies a patch only to the exact version it names. Upgrading
    // Streamdown without porting the patch silently drops the cache.
    const root = path.resolve(import.meta.dir, "../../../..");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      patchedDependencies: Record<string, string>;
    };
    const installed = JSON.parse(
      fs.readFileSync(Bun.resolveSync("streamdown/package.json", import.meta.dir), "utf8"),
    ) as { version: string };
    expect(Object.keys(manifest.patchedDependencies).filter((key) => key.startsWith("streamdown@"))).toEqual([
      `streamdown@${installed.version}`,
    ]);
  });

  test("more than 250 short documents stay cached", async () => {
    await show("Document 0.");
    for (let i = 1; i <= 300; i += 1) await show(`Document ${i}.`);
    const first = seen[0];
    await show("Document 0.");
    expect(seen.at(-1)).toBe(first);
  });

  test("a document longer than the character bound is parsed every time", async () => {
    const huge = `${"word ".repeat(200_001)}end.`;
    await show(huge);
    await show(huge);
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
  });
});
