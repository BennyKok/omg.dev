import { describe, expect, test } from "bun:test";
import { autoBuildSwitch, planAutoBuildLaunch, routeAutoLaunch } from "./auto-build-model.ts";
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

// On a hosted Computer the router's judge decides whether a new Auto session
// starts a new project. A question must stay on Auto even in a new chat, a
// new project inside an existing project must build, and any router failure
// must fall back to the local guess so a session always starts.
describe("Auto routing through the hosted router", () => {
  const input = { agent: "omg", model: OMG_AUTO_MODEL, firstRun: true, noProject: true, message: "Build a snake game" };
  const router = (answer: unknown, status = 200) => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(answer), { status });
    }) as unknown as typeof globalThis.fetch;
    return { calls, deps: { hosted: true, baseUrl: "http://169.254.0.1:9090/v1", fetch } };
  };

  test("the judge's alias decides", async () => {
    const build = router({ alias: "omg/build", routeId: "rt_1", source: "jev" });
    expect(await routeAutoLaunch({ ...input, firstRun: false, noProject: false, project: "Tip Calc" }, build.deps))
      .toEqual({ model: OMG_BUILD_MODEL, autoNextModel: OMG_AUTO_MODEL, routeId: "rt_1", routeSource: "jev" });
    expect(build.calls[0]!.url).toBe("http://169.254.0.1:9090/v1/omg/route");
    expect(build.calls[0]!.body).toMatchObject({ message: "Build a snake game", project: "Tip Calc", noProject: false, newApp: false });

    const ask = router({ alias: "omg/auto", routeId: "rt_2", source: "jev" });
    expect(await routeAutoLaunch({ ...input, message: "How do I add a domain?" }, ask.deps))
      .toEqual({ model: OMG_AUTO_MODEL, routeId: "rt_2", routeSource: "jev" });
  });

  test("failures and non-hosted boxes keep the local guess", async () => {
    expect((await routeAutoLaunch(input, router({}, 500).deps)).model).toBe(OMG_BUILD_MODEL);
    const down = { hosted: true, baseUrl: "http://169.254.0.1:9090", fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch };
    expect(await routeAutoLaunch(input, down)).toMatchObject({ model: OMG_BUILD_MODEL, autoNextModel: OMG_AUTO_MODEL, routeSource: "unreachable" });
    const local = router({ alias: "omg/auto" });
    expect(await routeAutoLaunch(input, { ...local.deps, hosted: false })).toEqual({ model: OMG_BUILD_MODEL, autoNextModel: OMG_AUTO_MODEL });
    expect(local.calls).toHaveLength(0);
    // A specific model or a subagent never asks.
    expect((await routeAutoLaunch({ ...input, model: "omg/anthropic/claude-opus-5.5" }, local.deps)).model).toBe("omg/anthropic/claude-opus-5.5");
    expect((await routeAutoLaunch({ ...input, spawnedBy: "subagent" }, local.deps)).model).toBe(OMG_AUTO_MODEL);
    expect(local.calls).toHaveLength(0);
  });
});
