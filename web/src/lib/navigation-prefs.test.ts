import { describe, expect, test } from "bun:test";
import { parseNavigationPrefs } from "./navigation-prefs";

describe("navigation preferences", () => {
  test("keeps swipe-between-chats enabled for existing users", () => {
    expect(parseNavigationPrefs(null)).toEqual({ swipeBetweenChats: true });
    expect(parseNavigationPrefs("{}")).toEqual({ swipeBetweenChats: true });
  });

  test("restores an explicit disabled preference", () => {
    expect(parseNavigationPrefs('{"swipeBetweenChats":false}')).toEqual({
      swipeBetweenChats: false,
    });
  });

  test("falls back safely when browser storage is malformed", () => {
    expect(parseNavigationPrefs("not json")).toEqual({ swipeBetweenChats: true });
  });
});
