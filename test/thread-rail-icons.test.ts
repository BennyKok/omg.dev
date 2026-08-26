import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const RAIL_ITEM = APP.slice(
  APP.indexOf("const RailItem = memo(function RailItem({"),
  APP.indexOf("\n/**\n * The bot roster's row", APP.indexOf("const RailItem = memo(function RailItem({")),
);

describe("thread rail identity marks", () => {
  test("hides Claude account numbers from both rail agent placements", () => {
    expect(RAIL_ITEM.match(/showAccountNumber=\{false\}/g)).toHaveLength(2);
  });

  test("puts working progress around a discovered project favicon", () => {
    const faviconBranch = RAIL_ITEM.slice(
      RAIL_ITEM.indexOf(") : showFavicon ? ("),
      RAIL_ITEM.indexOf(") : (", RAIL_ITEM.indexOf(") : showFavicon ? (") + 1),
    );
    expect(faviconBranch).toContain('aria-label="working"');
    expect(faviconBranch).toContain("size-9 animate-spin");
    expect(faviconBranch).toContain("src={faviconSrc}");
  });

  test("keeps the agent badge still when the favicon owns progress", () => {
    const badge = RAIL_ITEM.slice(RAIL_ITEM.indexOf("!drivingBot && showFavicon"));
    expect(badge).toContain("busy={false}");
    expect(badge).toContain("compact");
  });
});
