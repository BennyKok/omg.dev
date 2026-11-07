import { describe, expect, test } from "bun:test";
import { phonePageAfterSwipe, phonePageSwipe } from "./phone-pages";

describe("phonePageAfterSwipe", () => {
  test("Chats opens Folders to the left and the Inbox to the right", () => {
    expect(phonePageAfterSwipe("live", "right")).toBe("folders");
    expect(phonePageAfterSwipe("live", "left")).toBe("notifications");
  });

  test("the Inbox goes back to Chats or on to the Computer", () => {
    expect(phonePageAfterSwipe("notifications", "right")).toBe("live");
    expect(phonePageAfterSwipe("notifications", "left")).toBe("computer");
  });

  test("Folders is the first page", () => {
    expect(phonePageAfterSwipe("folders", "left")).toBe("live");
    expect(phonePageAfterSwipe("folders", "right")).toBeNull();
  });

  test("the Computer is the last page", () => {
    expect(phonePageAfterSwipe("computer", "right")).toBe("notifications");
    expect(phonePageAfterSwipe("computer", "left")).toBeNull();
  });

  test("pages outside the row do not swipe", () => {
    expect(phonePageAfterSwipe("settings", "left")).toBeNull();
    expect(phonePageAfterSwipe("auto", "right")).toBeNull();
  });
});

describe("phonePageSwipe", () => {
  test("a short or mostly vertical drag is a scroll, not a swipe", () => {
    expect(phonePageSwipe({ tab: "live", dx: 30, dy: 0, startX: 200 })).toBeNull();
    expect(phonePageSwipe({ tab: "live", dx: 80, dy: 70, startX: 200 })).toBeNull();
  });

  test("a clear sideways drag swipes either way", () => {
    expect(phonePageSwipe({ tab: "live", dx: 90, dy: 10, startX: 100 })).toBe("right");
    expect(phonePageSwipe({ tab: "live", dx: -90, dy: 10, startX: 300 })).toBe("left");
  });

  test("on the Computer only a swipe right from the left edge leaves", () => {
    expect(phonePageSwipe({ tab: "computer", dx: 90, dy: 0, startX: 200 })).toBeNull();
    expect(phonePageSwipe({ tab: "computer", dx: -90, dy: 0, startX: 10 })).toBeNull();
    expect(phonePageSwipe({ tab: "computer", dx: 90, dy: 0, startX: 10 })).toBe("right");
  });
});
