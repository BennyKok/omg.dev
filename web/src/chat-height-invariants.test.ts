import { expect, test } from "bun:test";

const APP = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

test("harvested markdown metrics invalidate TanStack's stale fallback offsets", () => {
  const start = APP.indexOf("const measuredMetricsVersionRef = useRef(0);");
  const end = APP.indexOf("const virtualRows = virtualizer.getVirtualItems();", start);
  const effect = APP.slice(start, end);

  expect(start).toBeGreaterThan(0);
  expect(effect).toContain("metrics.version === measuredMetricsVersionRef.current");
  expect(effect).toContain("virtualizer.measure();");
  expect(effect).toContain("virtualizer.measureElement(row);");
  expect(effect).toContain("[metrics.version, rowContext, virtualizer]");
  expect(effect).not.toContain("scrollTop =");
});
