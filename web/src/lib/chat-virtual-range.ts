import { defaultRangeExtractor, type Range } from "@tanstack/react-virtual";

/** Keep the live tail measured even when the viewport overlaps only its start. */
export function chatVirtualRange(range: Range, tailRows: number): number[] {
  const tailStart = Math.max(0, range.count - tailRows);
  const indexes = defaultRangeExtractor(range).filter(
    (index) => index < tailStart,
  );
  for (let index = tailStart; index < range.count; index++) {
    indexes.push(index);
  }
  return indexes;
}
