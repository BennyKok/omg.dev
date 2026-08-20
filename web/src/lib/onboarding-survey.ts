// Data and pure state-machine helpers for the 4-question survey the embedded
// connect gate shows before its agent/tool connect pages (see
// components/embedded-connect-gate.tsx for where this renders).
//
// Kept framework-free on purpose: no React, no DOM. `icon` on each option is
// a string key the component resolves — either a lucide icon name, or
// `agent:<kind>` for a real agent mark via agentIconSrc/agentIconAlt. That
// keeps this file testable under plain `bun test` and keeps the question
// data, the page-flow sequencing, and the skip/multi-select mechanics in one
// place the component just renders.

export type SurveyIdentity = "founder" | "designer" | "creator" | "side-hustle";
export type SurveyPain = "waiting" | "phone" | "context" | "offline";
export type SurveyDailyTool = "notion" | "dropbox" | "drive" | "chat" | "slack";
// Mirrors SHOWCASE_AGENTS in embedded-connect-gate.tsx — the same five
// agents the picker leads with (see DISCOVERABLE_AGENT_COUNT there). Kept as
// a literal list rather than importing AGENT_CATALOG so this survey always
// shows the agents a person can actually recognise on the connect page right
// after it, not every kind the server happens to support.
export type SurveyAiTool = "aisdk" | "codex-aisdk" | "grok" | "cursor" | "opencode";

export type SurveyOption<V extends string> = {
  value: V;
  label: string;
  icon: string;
};

// "Side hustle" used to carry a moon (time-of-day) next to three role
// metaphors (rocket, palette, sparkles) — a different kind of metaphor in
// the same row. Layers reads as "juggling more than one thing", which is
// what a side hustle actually is, and stays in the same "what you do"
// register as the other three.
export const IDENTITY_OPTIONS: readonly SurveyOption<SurveyIdentity>[] = [
  { value: "founder", label: "Founder", icon: "rocket" },
  { value: "designer", label: "Designer", icon: "palette" },
  { value: "creator", label: "Creator", icon: "sparkles" },
  { value: "side-hustle", label: "Side hustle", icon: "layers" },
];

// 4 options, not 5: the original 5th ("I do not trust AI with real work")
// was the only trust-flavored option in an otherwise all-friction list, so
// it would absorb clicks that don't point at anything actionable the way
// the other four do. Dropped rather than replaced — 4 options also matches
// IDENTITY_OPTIONS' even 2x2 grid with no orphaned last tile.
export const PAIN_OPTIONS: readonly SurveyOption<SurveyPain>[] = [
  { value: "waiting", label: "I wait for AI to finish tasks", icon: "clock" },
  { value: "phone", label: "I want to code from my phone", icon: "smartphone" },
  { value: "context", label: "I lose context switching agents", icon: "shuffle" },
  { value: "offline", label: "My agent stops when I close my laptop", icon: "laptop" },
];

// Real brand marks (see ../lib/brand-icons.tsx), not generic clipart — a
// notebook glyph for Notion, a box for Dropbox and a hard-drive glyph for
// Google Drive read as nothing in particular, next to an actually-recognisable
// Slack mark. `brand:<name>` is resolved by SurveyOptionIcon in
// embedded-connect-gate.tsx, same pattern as the `agent:<kind>` icons below.
export const DAILY_TOOL_OPTIONS: readonly SurveyOption<SurveyDailyTool>[] = [
  { value: "notion", label: "Notion", icon: "brand:notion" },
  { value: "dropbox", label: "Dropbox", icon: "brand:dropbox" },
  { value: "drive", label: "Google Drive", icon: "brand:google-drive" },
  { value: "chat", label: "WhatsApp", icon: "brand:whatsapp" },
  { value: "slack", label: "Slack", icon: "brand:slack" },
];

// The 5 agents this gate leads with everywhere it shows a curated agent row
// — this survey's AI-tools question AND the closing "Bring your own coding
// agent" showcase in embedded-connect-gate.tsx both point at this one list,
// so there is a single owner for "which agents does the first run show".
export const SHOWCASE_AGENT_KINDS: readonly SurveyAiTool[] = [
  "aisdk",
  "codex-aisdk",
  "grok",
  "cursor",
  "opencode",
];

const AI_TOOL_LABELS: Record<SurveyAiTool, string> = {
  aisdk: "Claude Code",
  "codex-aisdk": "Codex",
  grok: "Grok",
  cursor: "Cursor",
  opencode: "OpenCode",
};

export const AI_TOOL_OPTIONS: readonly SurveyOption<SurveyAiTool>[] = SHOWCASE_AGENT_KINDS.map((kind) => ({
  value: kind,
  label: AI_TOOL_LABELS[kind],
  icon: `agent:${kind}`,
}));

export type SurveyPageId = "survey-identity" | "survey-pain" | "survey-tools" | "survey-ai";
export type ConnectPageId = "agents" | "tools" | "value";
export type GatePage = SurveyPageId | ConnectPageId;

export const SURVEY_PAGES: readonly SurveyPageId[] = [
  "survey-identity",
  "survey-pain",
  "survey-tools",
  "survey-ai",
];

export function isSurveyPage(page: GatePage): page is SurveyPageId {
  return (SURVEY_PAGES as readonly GatePage[]).includes(page);
}

// The full first-run flow: 4 survey questions, then the existing connect
// pages. `toolsUsable` is the same "skip the tools page when nothing on it
// can be connected" check the gate already does — see its own comment in
// embedded-connect-gate.tsx for why that page can disappear from the flow.
export function buildGateFlow(toolsUsable: boolean): GatePage[] {
  const connect: ConnectPageId[] = toolsUsable ? ["agents", "tools", "value"] : ["agents", "value"];
  return [...SURVEY_PAGES, ...connect];
}

export function stepAfter(flow: readonly GatePage[], current: GatePage): GatePage {
  const i = flow.indexOf(current);
  return flow[Math.min(i + 1, flow.length - 1)] ?? current;
}

export function stepBefore(flow: readonly GatePage[], current: GatePage): GatePage {
  const i = flow.indexOf(current);
  return flow[Math.max(i - 1, 0)] ?? current;
}

// Toggle membership in a multi-select answer list, immutably.
export function toggleMulti<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export type SurveyAnswers = {
  identity: SurveyIdentity | null;
  pain: SurveyPain | null;
  dailyTools: SurveyDailyTool[];
  aiTools: SurveyAiTool[];
};

export const EMPTY_SURVEY_ANSWERS: SurveyAnswers = {
  identity: null,
  pain: null,
  dailyTools: [],
  aiTools: [],
};

export type SurveyAnalyticsEvent = { name: string; data: Record<string, unknown> };

const ANSWER_EVENT_NAMES: Record<SurveyPageId, string> = {
  "survey-identity": "onboarding_survey_identity",
  "survey-pain": "onboarding_survey_pain",
  "survey-tools": "onboarding_survey_daily_tools",
  "survey-ai": "onboarding_survey_ai_tools",
};

// Fired the moment a question is actually answered (not skipped) — single
// value for single-select pages, array for multi-select.
export function surveyAnswerEvent(page: SurveyPageId, value: string | string[]): SurveyAnalyticsEvent {
  return { name: ANSWER_EVENT_NAMES[page], data: { value } };
}

// Fired once, when the survey is left (finished or skipped through). Each
// field reports "skipped" when the person never answered that question, so
// the completion event alone tells the whole story of the run.
export function surveyCompleteEvent(answers: SurveyAnswers): SurveyAnalyticsEvent {
  return {
    name: "onboarding_survey_complete",
    data: {
      identity: answers.identity ?? "skipped",
      pain: answers.pain ?? "skipped",
      dailyTools: answers.dailyTools.length ? answers.dailyTools : "skipped",
      aiTools: answers.aiTools.length ? answers.aiTools : "skipped",
    },
  };
}
