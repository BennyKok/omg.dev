import { expect, test } from "bun:test";

import { createPlatformLiveActivity } from "../src/omg/platform-live-activity";

const component = () => ({}) as never;

test("does not construct the iOS Live Activity factory on Android", () => {
  let calls = 0;
  const factory = createPlatformLiveActivity(
    "android",
    () => {
      calls += 1;
      throw new Error("the iOS constructor must not run");
    },
    "OmgAgentsActivity",
    component,
  );

  expect(calls).toBe(0);
  expect(factory.getInstances()).toEqual([]);
  expect(() => factory.start({})).toThrow("Live Activities are available only on iOS");
});

test("constructs the factory on iOS", () => {
  const expected = {
    getInstances: () => [],
    start: () => {
      throw new Error("unused");
    },
  };
  const factory = createPlatformLiveActivity(
    "ios",
    () => expected as never,
    "OmgAgentsActivity",
    component,
  );

  expect(factory).toBe(expected);
});
