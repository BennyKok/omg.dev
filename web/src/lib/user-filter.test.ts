import { describe, expect, test } from "bun:test";
import { sessionMatchesUserFilter } from "./user-filter";

const benny = { assignedUser: "benny@example.com" };
const angel = { assignedUser: "angel@example.com" };
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
    expect(sessionMatchesUserFilter(benny, "benny@example.com")).toBe(true);
  });

  test("a person does NOT see another person's sessions", () => {
    expect(sessionMatchesUserFilter(angel, "benny@example.com")).toBe(false);
  });

  // The regression this helper exists for: an app-created session was visible
  // on the phone and invisible on the web, because the phone forces "__all"
  // (isHostedSurface) while the browser had a saved person filter.
  test("a person ALSO sees unassigned sessions", () => {
    expect(sessionMatchesUserFilter(fromPhone, "benny@example.com")).toBe(true);
    expect(sessionMatchesUserFilter(fromPhone, "angel@example.com")).toBe(true);
  });

  test("treats undefined and empty-string owners as unassigned", () => {
    expect(sessionMatchesUserFilter({}, "benny@example.com")).toBe(true);
    expect(sessionMatchesUserFilter({ assignedUser: "" }, "benny@example.com")).toBe(true);
    expect(sessionMatchesUserFilter({}, "__unassigned")).toBe(true);
  });
});
