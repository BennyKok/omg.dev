import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const app = readFileSync("web/src/App.tsx", "utf8");

function pausedBanner(): string {
  const start = app.indexOf("function PausedBanner(");
  const end = app.indexOf("function CodingAgentAuthPanel(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return app.slice(start, end);
}

describe("restart recovery banner", () => {
  test("does not use an emoji in the banner title", () => {
    const banner = pausedBanner();

    expect(banner).toContain('<div className="font-semibold text-warning">{title}</div>');
    expect(banner).not.toContain("⏸");
  });

  // The one-tap Continue (dropped in 47edd4fad: a send now resumes these
  // sessions) and the row pause icon (d0fb04c06: blocked rows name the fix)
  // are gone on purpose. Neither may come back as an emoji.
  test("no paused emoji on a blocked row", () => {
    expect(app).not.toContain("⏸ paused");
  });
});
