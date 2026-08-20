import { describe, expect, test } from "bun:test";
import {
  AI_TOOL_OPTIONS,
  buildGateFlow,
  DAILY_TOOL_OPTIONS,
  EMPTY_SURVEY_ANSWERS,
  IDENTITY_OPTIONS,
  isSurveyPage,
  PAIN_OPTIONS,
  stepAfter,
  stepBefore,
  SURVEY_PAGES,
  surveyAnswerEvent,
  surveyCompleteEvent,
  toggleMulti,
} from "./onboarding-survey";

describe("buildGateFlow", () => {
  test("puts all 4 survey pages ahead of agents/tools/value", () => {
    expect(buildGateFlow(true)).toEqual([
      "survey-identity",
      "survey-pain",
      "survey-tools",
      "survey-ai",
      "agents",
      "tools",
      "value",
    ]);
  });

  test("drops the tools page when nothing on it can be connected, same as before", () => {
    expect(buildGateFlow(false)).toEqual([
      "survey-identity",
      "survey-pain",
      "survey-tools",
      "survey-ai",
      "agents",
      "value",
    ]);
  });
});

describe("isSurveyPage", () => {
  test("true for all 4 survey pages, false for connect pages", () => {
    for (const page of SURVEY_PAGES) expect(isSurveyPage(page)).toBe(true);
    expect(isSurveyPage("agents")).toBe(false);
    expect(isSurveyPage("tools")).toBe(false);
    expect(isSurveyPage("value")).toBe(false);
  });
});

describe("stepAfter / stepBefore — the skip path", () => {
  test("skipping every survey question in sequence lands on agents, same place a full answer would", () => {
    const flow = buildGateFlow(true);
    let page: (typeof flow)[number] = "survey-identity";
    // "Skip" never inspects the answer — it just walks the flow forward,
    // which is exactly what the gate's skip button does.
    page = stepAfter(flow, page);
    page = stepAfter(flow, page);
    page = stepAfter(flow, page);
    page = stepAfter(flow, page);
    expect(page).toBe("agents");
  });

  test("stays on the last page instead of walking off the end", () => {
    const flow = buildGateFlow(true);
    expect(stepAfter(flow, "value")).toBe("value");
  });

  test("stays on the first page instead of walking off the start", () => {
    const flow = buildGateFlow(true);
    expect(stepBefore(flow, "survey-identity")).toBe("survey-identity");
  });

  test("an unknown page (defensive: page state got out of sync) does not throw or move", () => {
    const flow = buildGateFlow(true);
    // indexOf returns -1 for a page not in the flow; both helpers must clamp
    // rather than compute a negative/absurd index.
    expect(stepAfter(flow, "nonexistent" as never)).toBe("survey-identity");
    expect(stepBefore(flow, "nonexistent" as never)).toBe("survey-identity");
  });
});

describe("toggleMulti", () => {
  test("adds a value not yet selected", () => {
    expect(toggleMulti([], "slack")).toEqual(["slack"]);
    expect(toggleMulti(["notion"], "slack")).toEqual(["notion", "slack"]);
  });

  test("removes a value already selected — the multi-select toggle behaviour", () => {
    expect(toggleMulti(["notion", "slack"], "notion")).toEqual(["slack"]);
  });

  test("is immutable: does not mutate the input array", () => {
    const original = ["notion"];
    const next = toggleMulti(original, "slack");
    expect(original).toEqual(["notion"]);
    expect(next).toEqual(["notion", "slack"]);
  });
});

describe("survey option data", () => {
  test("every question has at least 4 one-tap options", () => {
    expect(IDENTITY_OPTIONS.length).toBeGreaterThanOrEqual(4);
    expect(PAIN_OPTIONS.length).toBeGreaterThanOrEqual(4);
    expect(DAILY_TOOL_OPTIONS.length).toBeGreaterThanOrEqual(4);
    expect(AI_TOOL_OPTIONS.length).toBeGreaterThanOrEqual(4);
  });

  test("the AI tools question mirrors the gate's SHOWCASE_AGENTS kinds, not invented names", () => {
    // Kept in sync by hand (see the comment on SurveyAiTool) rather than a
    // shared import, but the values must be real agent kinds the picker
    // elsewhere in the app actually recognises.
    expect(AI_TOOL_OPTIONS.map((o) => o.value)).toEqual([
      "aisdk",
      "codex-aisdk",
      "grok",
      "cursor",
      "opencode",
    ]);
  });

  test("every option value is unique within its question", () => {
    for (const options of [IDENTITY_OPTIONS, PAIN_OPTIONS, DAILY_TOOL_OPTIONS, AI_TOOL_OPTIONS]) {
      const values = options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("analytics event shapes", () => {
  test("surveyAnswerEvent names each question distinctly and carries the value", () => {
    expect(surveyAnswerEvent("survey-identity", "founder")).toEqual({
      name: "onboarding_survey_identity",
      data: { value: "founder" },
    });
    expect(surveyAnswerEvent("survey-tools", ["notion", "slack"])).toEqual({
      name: "onboarding_survey_daily_tools",
      data: { value: ["notion", "slack"] },
    });
  });

  test("surveyCompleteEvent reports 'skipped' for every unanswered question", () => {
    expect(surveyCompleteEvent(EMPTY_SURVEY_ANSWERS)).toEqual({
      name: "onboarding_survey_complete",
      data: {
        identity: "skipped",
        pain: "skipped",
        dailyTools: "skipped",
        aiTools: "skipped",
      },
    });
  });

  test("surveyCompleteEvent reports real values for answered questions, mixed with skips", () => {
    const partial = {
      identity: "founder" as const,
      pain: null,
      dailyTools: ["notion", "slack"] as const,
      aiTools: [],
    };
    expect(surveyCompleteEvent(partial as never)).toEqual({
      name: "onboarding_survey_complete",
      data: {
        identity: "founder",
        pain: "skipped",
        dailyTools: ["notion", "slack"],
        aiTools: "skipped",
      },
    });
  });
});
