import { expect, test } from "bun:test";
import { chatVirtualRange } from "./chat-virtual-range";

test("the live reply stays mounted when scrolling within the retained tail", () => {
  expect(
    chatVirtualRange(
      { startIndex: 75, endIndex: 78, overscan: 2, count: 100 },
      30,
    ),
  ).toEqual(Array.from({ length: 30 }, (_, index) => index + 70));
});

test("older history and the live tail are kept without mounting the gap", () => {
  expect(
    chatVirtualRange(
      { startIndex: 5, endIndex: 7, overscan: 1, count: 100 },
      3,
    ),
  ).toEqual([4, 5, 6, 7, 8, 97, 98, 99]);
});

test("bottom and short transcripts have no duplicate or out-of-range rows", () => {
  expect(
    chatVirtualRange(
      { startIndex: 98, endIndex: 99, overscan: 1, count: 100 },
      3,
    ),
  ).toEqual([97, 98, 99]);
  expect(
    chatVirtualRange({ startIndex: 0, endIndex: 1, overscan: 6, count: 2 }, 30),
  ).toEqual([0, 1]);
});
