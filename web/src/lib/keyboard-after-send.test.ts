import { describe, expect, test } from "bun:test";
import { closesKeyboardAfterSend } from "./keyboard-after-send";

describe("the keyboard after a send", () => {
  test("a phone closes it, whichever way it is held", () => {
    expect(closesKeyboardAfterSend({ coarsePointer: true, screenWidth: 390, screenHeight: 844 })).toBe(true);
    expect(closesKeyboardAfterSend({ coarsePointer: true, screenWidth: 932, screenHeight: 430 })).toBe(true);
  });

  test("an iPad keeps the field focused, so its keyboard bar stays", () => {
    expect(closesKeyboardAfterSend({ coarsePointer: true, screenWidth: 820, screenHeight: 1180 })).toBe(false);
    expect(closesKeyboardAfterSend({ coarsePointer: true, screenWidth: 744, screenHeight: 1133 })).toBe(false);
  });

  test("a computer keeps the field focused", () => {
    expect(closesKeyboardAfterSend({ coarsePointer: false, screenWidth: 390, screenHeight: 844 })).toBe(false);
    expect(closesKeyboardAfterSend({ coarsePointer: false, screenWidth: 1440, screenHeight: 900 })).toBe(false);
  });
});
