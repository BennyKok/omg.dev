import { describe, expect, test } from "bun:test";
import { attempt, attemptAsync, errorMessage } from "./attempt";

describe("attempt", () => {
  test("returns the work's value and runs onFinally", () => {
    const order: string[] = [];
    const value = attempt(
      () => (order.push("work"), 1),
      () => (order.push("error"), 2),
      () => order.push("finally"),
    );
    expect(value).toBe(1);
    expect(order).toEqual(["work", "finally"]);
  });

  test("returns onError's value when the work throws", () => {
    expect(attempt(() => JSON.parse("{"), () => "fallback")).toBe("fallback");
  });

  test("without onError the error propagates after onFinally", () => {
    const order: string[] = [];
    expect(() =>
      attempt(
        () => {
          throw new Error("boom");
        },
        undefined,
        () => order.push("finally"),
      ),
    ).toThrow("boom");
    expect(order).toEqual(["finally"]);
  });
});

describe("attemptAsync", () => {
  test("waits for an async onFinally before it settles", async () => {
    const order: string[] = [];
    await attemptAsync(
      async () => {
        order.push("work");
      },
      undefined,
      async () => {
        await Promise.resolve();
        order.push("finally");
      },
    );
    order.push("after");
    expect(order).toEqual(["work", "finally", "after"]);
  });

  test("an error thrown from onError rejects, after onFinally", async () => {
    const order: string[] = [];
    const run = attemptAsync(
      async () => {
        throw new Error("first");
      },
      (error) => {
        order.push(`error:${errorMessage(error)}`);
        throw new Error("second");
      },
      () => {
        order.push("finally");
      },
    );
    await expect(run).rejects.toThrow("second");
    expect(order).toEqual(["error:first", "finally"]);
  });

  test("a value returned from onError is the result", async () => {
    const result = await attemptAsync<string, null>(
      async () => {
        throw new Error("x");
      },
      () => null,
    );
    expect(result).toBeNull();
  });
});
