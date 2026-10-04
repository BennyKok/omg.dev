import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

// app.omg.dev budgets the Computer surface's static closure, and the embedded
// LFG chunk is most of it. The Connectors page is a Settings destination, so it
// must stay behind a dynamic import; Settings only needs the small row.
describe("Connectors page stays off the eager bundle", () => {
  test("App.tsx has no static import of connectors-page", () => {
    expect(APP).not.toMatch(/^import[^;]*from "\.\/views\/connectors-page";/m);
  });

  test("App.tsx loads the page with a dynamic import", () => {
    expect(APP).toContain('import("./views/connectors-page")');
  });
});
