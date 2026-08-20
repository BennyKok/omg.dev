import { describe, expect, test } from "bun:test";
import { botQuotaPresentation } from "./bot-quota";

describe("persistent bot quota copy", () => {
  test("shows usage and remaining capacity before creation", () => {
    expect(botQuotaPresentation({
      used: 7,
      limit: 20,
      remaining: 13,
      scope: "owner",
      source: "default",
    })).toEqual({
      usage: "7 of 20 persistent bots used · 13 remaining",
      limitMessage: null,
      reached: false,
    });
  });

  test("gives a precise action at the limit", () => {
    expect(botQuotaPresentation({
      used: 20,
      limit: 20,
      remaining: 0,
      scope: "owner",
      source: "host_entitlement",
    })).toEqual({
      usage: "20 of 20 persistent bots used · 0 remaining",
      limitMessage: "You have 20 of 20 persistent bots. Delete a bot before creating another.",
      reached: true,
    });
  });

  test("explains why legacy ownerless bots do not consume a personal allowance", () => {
    expect(botQuotaPresentation({
      used: 3,
      limit: null,
      remaining: null,
      scope: "legacy_pool",
      source: "legacy",
    }).usage).toBe("3 ownerless legacy bots stored. They do not use a personal bot allowance.");
  });
});
