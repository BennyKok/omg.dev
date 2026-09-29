import { describe, expect, test } from "bun:test";
import { planLimitLiveAgents } from "./plan-limit-live";

describe("planLimitLiveAgents", () => {
  test("lists every live chat, whatever project it is in", () => {
    const live = planLimitLiveAgents([
      { sessionId: "a1", title: "Create Expo app", project: "expo-go-probe" },
      { sessionId: "b2", lastUserText: "Build a family meals app", project: "" },
      { sessionId: "c3", project: "level-check" },
    ]);
    expect(live).toEqual([
      { sessionId: "a1", title: "Create Expo app", project: "expo-go-probe" },
      { sessionId: "b2", title: "Build a family meals app", project: "" },
      { sessionId: "c3", title: "c3", project: "level-check" },
    ]);
  });

  test("leaves out what the plan does not count", () => {
    const live = planLimitLiveAgents([
      { sessionId: "sched", spawnedBy: "schedule", project: "x" },
      { sessionId: "bot", botId: "bot_1", project: "" },
      { sessionId: "dup", title: "one" },
      { sessionId: "dup", title: "two" },
      { title: "no id" },
    ]);
    expect(live.map((agent) => agent.sessionId)).toEqual(["dup"]);
  });
});
