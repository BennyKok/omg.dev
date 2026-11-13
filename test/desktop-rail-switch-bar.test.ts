import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../web/src/index.css", import.meta.url), "utf8");

// Navigation behavior is rendered in web/src/navigation-controls.test.tsx.
test("the compact dock keeps touch-sized targets and a visible focus ring", () => {
  expect(CSS).toMatch(/\.lfg-surface-toggle--dock \.t-tab,[\s\S]*?height: 44px;/);
  expect(CSS).toMatch(/\.t-tab:focus-visible \{[\s\S]*?outline: 2px solid var\(--ring\);/);
});
