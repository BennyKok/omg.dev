import { describe, expect, test } from "bun:test";
import { autoBuildSwitch, planAutoBuildLaunch } from "./auto-build-model.ts";
import { OMG_AUTO_MODEL, OMG_BUILD_MODEL, OMG_MODELS } from "./omg-models.ts";

// Auto must give a new app its first build on the build model, and move the
// session to the cheaper Auto model at the person's second message. If the
// build model stayed on, every later change would cost build-model prices; if
// a notice or an agent update ended the build early, the app would be built
// on the cheap model.
describe("Auto build, then changes", () => {
  test("only an Auto new-app session launches on the build model", () => {
    expect(planAutoBuildLaunch({ agent: "omg", model: OMG_AUTO_MODEL, firstRun: true }))
      .toEqual({ model: OMG_BUILD_MODEL, autoNextModel: OMG_AUTO_MODEL });
    expect(planAutoBuildLaunch({ agent: "opencode", model: OMG_AUTO_MODEL, firstRun: true }).model).toBe(OMG_BUILD_MODEL);
    // A session on an existing app, a specific model, a subagent: unchanged.
    expect(planAutoBuildLaunch({ agent: "omg", model: OMG_AUTO_MODEL, firstRun: false })).toEqual({ model: OMG_AUTO_MODEL });
    expect(planAutoBuildLaunch({ agent: "omg", model: "omg/anthropic/claude-opus-5.5", firstRun: true }))
      .toEqual({ model: "omg/anthropic/claude-opus-5.5" });
    expect(planAutoBuildLaunch({ agent: "omg", model: OMG_AUTO_MODEL, firstRun: true, spawnedBy: "subagent" }))
      .toEqual({ model: OMG_AUTO_MODEL });
    expect(planAutoBuildLaunch({ agent: "claude", model: OMG_AUTO_MODEL, firstRun: true })).toEqual({ model: OMG_AUTO_MODEL });
    // The session must be able to launch on it.
    expect(OMG_MODELS).toContain(OMG_BUILD_MODEL);
  });

  test("the person's next message switches; machine messages and agent updates do not", () => {
    const building = { autoNextModel: OMG_AUTO_MODEL };
    expect(autoBuildSwitch(building, "Make the jump higher", true)).toBe(OMG_AUTO_MODEL);
    expect(autoBuildSwitch(building, "[omg builder] The app is not published yet", true)).toBeNull();
    expect(autoBuildSwitch(building, "[Scheduled routine: daily] check", true)).toBeNull();
    expect(autoBuildSwitch(building, "[subagent complete] done", true)).toBeNull();
    expect(autoBuildSwitch(building, "Make the jump higher", false)).toBeNull();
    // After the switch (or on any other session) nothing happens.
    expect(autoBuildSwitch({}, "Make the jump higher", true)).toBeNull();
    expect(autoBuildSwitch(undefined, "Make the jump higher", true)).toBeNull();
  });
});
