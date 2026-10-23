import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { mount, type Mounted } from "../../test-support/render";

const { StreamdownResponse } = await import("./streamdown-response");

// patches/streamdown@2.6.0.patch: a finished block reuses its parsed tree, so a
// transcript that mounts again (every session switch) does not parse every
// visible block again. Streamdown hands each component the tree node it came
// from, which makes the reuse observable without timing anything.

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
});
