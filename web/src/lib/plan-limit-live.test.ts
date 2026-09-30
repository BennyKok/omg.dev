import { describe, expect, test } from "bun:test";
import { filtersToShowSession, planLimitLiveAgents } from "./plan-limit-live";
import { NO_PROJECT_FILTER } from "./project-filter";

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

describe("filtersToShowSession", () => {
  test("a chat in another project scopes Home to that project", () => {
    expect(
      filtersToShowSession({ project: "family-feast" }, { userFilter: "__all", projectFilter: NO_PROJECT_FILTER }),
    ).toEqual({ projectFilter: "family-feast" });
  });

  test("a no-project chat scopes Home to the no-project list", () => {
    expect(
      filtersToShowSession({ project: "" }, { userFilter: "__all", projectFilter: "family-feast" }),
    ).toEqual({ projectFilter: NO_PROJECT_FILTER });
  });

  test("a chat another person owns clears the person filter", () => {
    expect(
      filtersToShowSession(
        { project: "", assignedUser: "angel" },
        { userFilter: "benny", projectFilter: NO_PROJECT_FILTER },
      ),
    ).toEqual({ userFilter: "__all" });
  });

  test("a chat Home already shows changes nothing", () => {
    expect(
      filtersToShowSession({ project: "p", assignedUser: "benny" }, { userFilter: "benny", projectFilter: "p" }),
    ).toEqual({});
  });
});
