import { describe, expect, test } from "bun:test";
import {
  initialUserFilter,
  sessionMatchesUserFilter,
  userFilterUpdatesStandaloneIdentity,
} from "./user-filter";

const benny = { assignedUser: "itechbenny@gmail.com" };
const angel = { assignedUser: "lyyluiyanyan@gmail.com" };
// What the native app produces: no identity header reaches the box, so the
// server has nobody to attribute a root session to.
const fromPhone = { assignedUser: null };

describe("sessionMatchesUserFilter", () => {
  test("__all shows everything", () => {
    for (const s of [benny, angel, fromPhone])
      expect(sessionMatchesUserFilter(s, "__all")).toBe(true);
  });

  test("__unassigned isolates the unclaimed pile", () => {
    expect(sessionMatchesUserFilter(fromPhone, "__unassigned")).toBe(true);
    expect(sessionMatchesUserFilter(benny, "__unassigned")).toBe(false);
  });

  test("a person sees their own sessions", () => {
    expect(sessionMatchesUserFilter(benny, "itechbenny@gmail.com")).toBe(true);
  });

  test("a person does NOT see another person's sessions", () => {
    expect(sessionMatchesUserFilter(angel, "itechbenny@gmail.com")).toBe(false);
  });

  // The regression this helper exists for: an app-created session was visible
  // on the phone and invisible on the web, because the phone forces "__all"
  // (isHostedSurface) while the browser had a saved person filter.
  test("a person ALSO sees unassigned sessions", () => {
    expect(sessionMatchesUserFilter(fromPhone, "itechbenny@gmail.com")).toBe(true);
    expect(sessionMatchesUserFilter(fromPhone, "lyyluiyanyan@gmail.com")).toBe(true);
  });

  test("treats undefined and empty-string owners as unassigned", () => {
    expect(sessionMatchesUserFilter({}, "itechbenny@gmail.com")).toBe(true);
    expect(sessionMatchesUserFilter({ assignedUser: "" }, "itechbenny@gmail.com")).toBe(true);
    expect(sessionMatchesUserFilter({}, "__unassigned")).toBe(true);
  });
});

describe("initialUserFilter", () => {
  test("starts a hosted surface with all users", () => {
    expect(
      initialUserFilter({
        savedFilter: null,
        standaloneProfile: "ada@example.com",
        hosted: true,
      }),
    ).toBe("__all");
  });

  test("restores an explicit hosted roster selection", () => {
    expect(
      initialUserFilter({
        savedFilter: "ada@example.com",
        standaloneProfile: null,
        hosted: true,
      }),
    ).toBe("ada@example.com");
  });

  test("uses the local profile on a standalone surface", () => {
    expect(
      initialUserFilter({
        savedFilter: null,
        standaloneProfile: "ada@example.com",
        hosted: false,
      }),
    ).toBe("ada@example.com");
  });
});

describe("userFilterUpdatesStandaloneIdentity", () => {
  test("keeps hosted filtering separate from standalone identity", () => {
    expect(userFilterUpdatesStandaloneIdentity("ada@example.com", true)).toBe(false);
  });

  test("updates standalone identity only for a concrete person", () => {
    expect(userFilterUpdatesStandaloneIdentity("ada@example.com", false)).toBe(true);
    expect(userFilterUpdatesStandaloneIdentity("__all", false)).toBe(false);
    expect(userFilterUpdatesStandaloneIdentity("__unassigned", false)).toBe(false);
  });
});
