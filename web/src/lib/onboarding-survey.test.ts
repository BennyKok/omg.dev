import { describe, expect, test } from "bun:test";
import {
  AI_TOOL_OPTIONS,
  buildGateFlow,
  createSurveyAnalyticsLatch,
  DAILY_TOOL_OPTIONS,
  EMPTY_SURVEY_ANSWERS,
  IDENTITY_OPTIONS,
  isSurveyPage,
  PAIN_OPTIONS,
  stepAfter,
  stepBefore,
  SURVEY_PAGES,
  surveyCompleteEvent,
  surveyQuestionEvent,
  toggleMulti,
} from "./onboarding-survey";

describe("buildGateFlow", () => {
  test("puts both survey pages ahead of agents/tools/value", () => {
    expect(buildGateFlow(true)).toEqual(["survey-identity", "survey-pain", "agents", "tools", "value"]);
  });

  test("drops the tools page when nothing on it can be connected, same as before", () => {
    expect(buildGateFlow(false)).toEqual(["survey-identity", "survey-pain", "agents", "value"]);
  });

  test("install is the last page when the browser can install", () => {
    expect(buildGateFlow(true, true)).toEqual([
      "survey-identity",
      "survey-pain",
      "agents",
      "tools",
      "value",
      "install",
    ]);
    expect(buildGateFlow(false, true)).toEqual([
      "survey-identity",
      "survey-pain",
      "agents",
      "value",
      "install",
    ]);
  });

  test("install never precedes agent connection or the value pitch", () => {
    for (const toolsUsable of [true, false]) {
      const flow = buildGateFlow(toolsUsable, true);
      expect(flow.indexOf("install")).toBe(flow.length - 1);
      expect(flow.indexOf("install")).toBeGreaterThan(flow.indexOf("agents"));
      expect(flow.indexOf("install")).toBeGreaterThan(flow.indexOf("value"));
    }
  });
});

describe("isSurveyPage", () => {
  test("true for both survey pages, false for connect pages", () => {
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
  // Still exported for the parked post-activation daily-tools/AI-tools
  // questions (see onboarding-survey.ts) even though the pre-connect flow's
  // two questions are both single-select and don't call it.
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
    // Parked (post-activation), not part of the pre-connect flow, but the
    // data must stay intact and valid so it's ready to reuse.
    expect(DAILY_TOOL_OPTIONS.length).toBeGreaterThanOrEqual(4);
    expect(AI_TOOL_OPTIONS.length).toBeGreaterThanOrEqual(4);
  });

  test("the parked AI tools question mirrors the gate's SHOWCASE_AGENTS kinds, not invented names", () => {
    // Kept in sync by hand (see the comment on SurveyAiTool) rather than a
    // shared import, but the values must be real agent kinds the picker
    // elsewhere in the app actually recognises.
    expect(AI_TOOL_OPTIONS.map((o) => o.value)).toEqual(["aisdk", "codex-aisdk", "grok", "cursor", "opencode"]);
  });

  test("every option value is unique within its question", () => {
    for (const options of [IDENTITY_OPTIONS, PAIN_OPTIONS, DAILY_TOOL_OPTIONS, AI_TOOL_OPTIONS]) {
      const values = options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("analytics event shapes", () => {
  // One event name for both questions — question id and answer travel as
  // properties, not baked into the event name, so per-question drop-off is
  // one query rather than one query per question.
  test("surveyQuestionEvent uses one event name and carries question + answer as props", () => {
    expect(surveyQuestionEvent("identity", "founder")).toEqual({
      event: "onboarding_survey_question",
      props: { question: "identity", answer: "founder" },
    });
    expect(surveyQuestionEvent("pain", "waiting")).toEqual({
      event: "onboarding_survey_question",
      props: { question: "pain", answer: "waiting" },
    });
  });

  test("surveyCompleteEvent reports 'skipped' for every unanswered question", () => {
    expect(surveyCompleteEvent(EMPTY_SURVEY_ANSWERS)).toEqual({
      event: "onboarding_survey_complete",
      props: { identity: "skipped", pain: "skipped" },
    });
  });

  test("surveyCompleteEvent reports real values for answered questions, mixed with skips", () => {
    expect(surveyCompleteEvent({ identity: "founder", pain: null })).toEqual({
      event: "onboarding_survey_complete",
      props: { identity: "founder", pain: "skipped" },
    });
  });
});

describe("createSurveyAnalyticsLatch", () => {
  // The bug this exists for: the connect page after the survey has a Back
  // button, and stepBefore lands on the last survey page. Answer, Back,
  // answer again, and the completion event fired twice for one run.
  test("the completion event fires once however many times it is asked", () => {
    const latch = createSurveyAnalyticsLatch();
    expect(latch.shouldFireComplete()).toBe(true);
    expect(latch.shouldFireComplete()).toBe(false);
    expect(latch.shouldFireComplete()).toBe(false);
  });

  test("re-answering a question with the same value reports nothing new", () => {
    const latch = createSurveyAnalyticsLatch();
    expect(latch.shouldFireQuestion("identity", "founder")).toBe(true);
    expect(latch.shouldFireQuestion("identity", "founder")).toBe(false);
  });

  test("a genuine correction is still recorded", () => {
    const latch = createSurveyAnalyticsLatch();
    expect(latch.shouldFireQuestion("identity", "founder")).toBe(true);
    expect(latch.shouldFireQuestion("identity", "designer")).toBe(true);
    expect(latch.shouldFireQuestion("identity", "founder")).toBe(false);
  });

  test("the two questions latch independently", () => {
    const latch = createSurveyAnalyticsLatch();
    expect(latch.shouldFireQuestion("identity", "founder")).toBe(true);
    expect(latch.shouldFireQuestion("pain", "founder")).toBe(true);
  });

  test("a fresh run starts clean", () => {
    const first = createSurveyAnalyticsLatch();
    first.shouldFireComplete();
    expect(createSurveyAnalyticsLatch().shouldFireComplete()).toBe(true);
  });
});
