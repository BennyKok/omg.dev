import { describe, expect, test } from "bun:test";
import { isAgentLimitError, isPlanLimitError } from "../web/src/lib/omg-client.ts";

/**
 * The refusal a host turns into an upgrade surface instead of a red error.
 *
 * The stand-ins below are shape-compatible rather than the real OmgApiError,
 * and deliberately so: importing packages/client/src from a root-level test
 * drags that package into the BACKEND typecheck, which runs without DOM lib
 * types and reports pre-existing errors there that have nothing to do with
 * this. The wire field itself (`code` on a failed request) is pinned where it
 * is produced, in packages/client/src/client.test.ts.
 *
 * Both failure modes this guards fail SILENTLY — the check just returns false
 * forever and the feature looks like it was never wired up.
 */

/** What @omg-dev/client raises for a tagged failure. */
class ApiErrorLike extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

describe("isPlanLimitError", () => {
  test("recognises a plan refusal", () => {
    expect(isPlanLimitError(new ApiErrorLike("plan wall", 429, "plan_limit"))).toBe(true);
  });

  test("recognises one raised by a DIFFERENT copy of the client", () => {
    // The case that matters in production. An embedding host builds the
    // transport with its own @omg-dev/client, so the error reaching us is an
    // instance of that copy's class — `instanceof` against ours is false, and
    // a second bundled copy is exactly this: same shape, different identity.
    class ForeignApiError extends Error {
      status = 429;
      code = "plan_limit";
    }
    expect(isPlanLimitError(new ForeignApiError("plan wall"))).toBe(true);
  });

  test("ignores an ordinary failure, however similar its wording", () => {
    // The near-identical wall reaches a SELF-HOSTED box when it hits its own
    // maxLiveAgents setting — a preference the person can edit, not a plan.
    // Only the code separates them, which is why the code exists.
    expect(
      isPlanLimitError(
        new ApiErrorLike("1 of 1 agents live — start anyway, close an agent", 429, "agent_limit"),
      ),
    ).toBe(false);
    expect(isPlanLimitError(new Error("your Computer plan allows 1 concurrent agents"))).toBe(
      false,
    );
  });

  test("survives anything that is not an error at all", () => {
    for (const value of [null, undefined, "plan_limit", 429, {}]) {
      expect(isPlanLimitError(value)).toBe(false);
    }
  });
});

/**
 * The self-hosted twin. It exists to keep the two walls apart: a host that sees
 * `plan_limit` opens a checkout, which is the wrong answer entirely for someone
 * who owns the machine and only has to raise a number they set themselves.
 */
describe("isAgentLimitError", () => {
  test("recognises the local cap refusal", () => {
    expect(isAgentLimitError(new ApiErrorLike("24 of 24 agents live", 429, "agent_limit"))).toBe(
      true,
    );
  });

  test("recognises one raised by a DIFFERENT copy of the client", () => {
    class ForeignApiError extends Error {
      status = 429;
      code = "agent_limit";
    }
    expect(isAgentLimitError(new ForeignApiError("local wall"))).toBe(true);
  });

  test("does not answer for the PLAN wall, or for an untagged failure", () => {
    expect(isAgentLimitError(new ApiErrorLike("plan wall", 429, "plan_limit"))).toBe(false);
    expect(isAgentLimitError(new ApiErrorLike("24 of 24 agents live", 429))).toBe(false);
  });

  test("survives anything that is not an error at all", () => {
    for (const value of [null, undefined, "agent_limit", 429, {}]) {
      expect(isAgentLimitError(value)).toBe(false);
    }
  });
});
