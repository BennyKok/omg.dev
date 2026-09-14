import { expect, test } from "bun:test";
import { canDragSheet, sheetDragDestination, sheetDragPosition } from "../mobile/src/omg/sheet-gesture";

test("nested scrollers and horizontal controls keep their touch sequence", () => {
  expect(canDragSheet(0, -6.67, { offset: 0, horizontal: false }, false)).toBe(true);
  expect(canDragSheet(1, 80, { offset: 30, horizontal: false }, false)).toBe(false);
  expect(canDragSheet(80, 1, { offset: 0, horizontal: true }, false)).toBe(false);
  expect(canDragSheet(1, 80, { offset: 0, horizontal: true }, false)).toBe(true);
  expect(canDragSheet(1, 80, { offset: 0, horizontal: false, blocked: true }, false)).toBe(false);
  expect(canDragSheet(70, 80, null, false)).toBe(false);
  expect(canDragSheet(1, -80, { offset: 0, horizontal: false }, false)).toBe(true);
  expect(canDragSheet(1, -80, { offset: 0, horizontal: false }, true)).toBe(false);
  expect(canDragSheet(1, 80, { offset: 0, horizontal: false }, true)).toBe(true);
});

test("drawer follows the finger across detents before moving down to dismiss", () => {
  expect(sheetDragPosition(700, 100, 400, 700)).toEqual({ height: 600, pull: 0 });
  expect(sheetDragPosition(700, 350, 400, 700)).toEqual({ height: 400, pull: 50 });
  expect(sheetDragPosition(400, -500, 400, 700)).toEqual({ height: 700, pull: 0 });
  expect(sheetDragDestination(400, -60, -0.2, 400, 700)).toBe("expanded");
  expect(sheetDragDestination(700, 60, 1, 400, 700)).toBe("compact");
  expect(sheetDragDestination(400, 25, 0.8, 400, 700)).toBe("dismiss");
  expect(sheetDragDestination(400, 100, 0.1, 400, 700)).toBe("dismiss");
  expect(sheetDragDestination(400, 10, 0.1, 400, 700)).toBe("compact");
});
