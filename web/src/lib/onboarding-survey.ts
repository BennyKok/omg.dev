// Data and pure state-machine helpers for the survey the embedded connect
// gate shows before its agent/tool connect pages (see
// components/embedded-connect-gate.tsx for where this renders).
//
// Kept framework-free on purpose: no React, no DOM. `icon` on each option is
// a string key the component resolves — either a lucide icon name, or
// `agent:<kind>` for a real agent mark via agentIconSrc/agentIconAlt. That
// keeps this file testable under plain `bun test` and keeps the question
// data, the page-flow sequencing, and the skip/multi-select mechanics in one
// place the component just renders.
//
// Pre-connect flow is 2 questions, not 4. The original 4-question version
// (identity, pain, daily tools, AI tools used) shipped in PR #185; a rework
// cut the last two ahead of the connect gate:
//   - the AI-tools question is answered with far better fidelity by which
//     coding agent the user actually connects on the very next screen, and
//   - the daily-tools question changes nothing about the next sixty seconds
//     of onboarding.
// DAILY_TOOL_OPTIONS, AI_TOOL_OPTIONS and their types are kept below rather
// than deleted — they are meant to run again post-activation (after a
// user's first successful agent run), where "what do you already use" is
// actually actionable. They are simply unreferenced by buildGateFlow/
// SURVEY_PAGES now; nothing in embedded-connect-gate.tsx imports them. See
// PARKED_FOR_POST_ACTIVATION below.

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

// PARKED_FOR_POST_ACTIVATION: not part of buildGateFlow / SURVEY_PAGES, and
// not imported by embedded-connect-gate.tsx. Kept intact — data, types and
// the brand-icons.tsx marks they point at — for a post-activation survey
// (after a user's first successful agent run) where "what do you use every
// day" is worth asking again. See the file header for why it left the
// pre-connect flow.
//
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

// PARKED_FOR_POST_ACTIVATION (see DAILY_TOOL_OPTIONS above): the AI-tools
// question drops out of the pre-connect flow because the very next screen
// (connect a coding agent) answers the same question with better fidelity —
// which agent someone actually signs into beats which ones they click in a
// survey. Kept for reuse after first successful agent run, where it can ask
// something the connect page can't (e.g. tools beyond the 5-agent showcase).
export const AI_TOOL_OPTIONS: readonly SurveyOption<SurveyAiTool>[] = SHOWCASE_AGENT_KINDS.map((kind) => ({
  value: kind,
  label: AI_TOOL_LABELS[kind],
  icon: `agent:${kind}`,
}));

// Pre-connect flow page ids. "survey-tools" and "survey-ai" (the parked
// questions above) are deliberately not page ids here — nothing routes to
// them, so there is nothing to keep in sync with a page that can't be
// reached. A post-activation flow gets its own ids when it's built.
export type SurveyPageId = "survey-identity" | "survey-pain";
// "install" is the optional add-to-home-screen page appended by
// buildGateFlow below (see feat/connect-gate-install-step, #213) — kept
// alongside the survey-page trim here since both live in the same union.
export type ConnectPageId = "agents" | "tools" | "value" | "install";
export type GatePage = SurveyPageId | ConnectPageId;

export const SURVEY_PAGES: readonly SurveyPageId[] = ["survey-identity", "survey-pain"];

export function isSurveyPage(page: GatePage): page is SurveyPageId {
  return (SURVEY_PAGES as readonly GatePage[]).includes(page);
}

// The full first-run flow: 2 survey questions, then the existing connect
// pages. `toolsUsable` is the same "skip the tools page when nothing on it
// can be connected" check the gate already does — see its own comment in
// embedded-connect-gate.tsx for why that page can disappear from the flow.
//
// `installable` appends the add-to-home-screen page, deliberately LAST: the
// install ask comes after agent connection and the value pitch, never in
// front of them (install-as-a-gate was the highest-drop-off screen the old
// signup wizard had). It only exists where the browser has a real install
// path — a captured native prompt, iOS, or Mac Safari instructions — because
// a dead step in a first run is worse than no step.
export function buildGateFlow(toolsUsable: boolean, installable = false): GatePage[] {
  const connect: ConnectPageId[] = toolsUsable ? ["agents", "tools", "value"] : ["agents", "value"];
  if (installable) connect.push("install");
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
};

export const EMPTY_SURVEY_ANSWERS: SurveyAnswers = {
  identity: null,
  pain: null,
};

// Wire shape matches `lfg:analytics` exactly (see lib/embed-host-signal.ts):
// `{ event, props }`. This module never tracks anything itself — a framed
// tracker mints its own Umami visitor/session on the sandbox's per-Computer
// origin and would never join the host's activation events (see
// embed-host-signal.ts header) — it only builds the event, and
// embedded-connect-gate.tsx posts it up via emitAnalyticsToHost.
export type SurveyAnalyticsEvent = { event: string; props: Record<string, string | number | boolean> };

// One event name for every question, not one per question — question id and
// answer travel as PROPERTIES so per-question drop-off is one query with a
// `group by question`, not a separate query per question name.
const SURVEY_QUESTION_EVENT = "onboarding_survey_question";
const SURVEY_COMPLETE_EVENT = "onboarding_survey_complete";

// Fired the moment a question is actually answered (not skipped).
export function surveyQuestionEvent(
  question: "identity" | "pain",
  answer: string,
): SurveyAnalyticsEvent {
  return { event: SURVEY_QUESTION_EVENT, props: { question, answer } };
}

// Fired once, when the survey is left (finished or skipped through). Each
// field reports "skipped" when the person never answered that question, so
// the completion event alone tells the whole story of the run.
export function surveyCompleteEvent(answers: SurveyAnswers): SurveyAnalyticsEvent {
  return {
    event: SURVEY_COMPLETE_EVENT,
    props: {
      identity: answers.identity ?? "skipped",
      pain: answers.pain ?? "skipped",
    },
  };
}

/**
 * Fire-once bookkeeping for the survey's two analytics events.
 *
 * The survey pages are reachable more than once. The connect page after the
 * survey has a Back button, and `stepBefore` lands straight back on the last
 * survey page, so answering, going Back, then answering or skipping again
 * would report a second completion for one run. That number is the funnel
 * denominator, so a duplicate does not add noise, it makes the rate wrong.
 *
 * Question events key on question AND answer. Someone who comes back and
 * picks something different has genuinely changed their answer, which is worth
 * recording. Someone who comes back and re-picks what they already had, or
 * just passes through, is not new information.
 *
 * Framework-free like the rest of this module: the component holds one of
 * these in a ref, and the whole rule is testable without React or a DOM.
 */
export type SurveyAnalyticsLatch = {
  /** True when this question/answer pair has not been reported yet. */
  shouldFireQuestion(question: string, answer: string): boolean;
  /** True the first time only, for the whole life of the latch. */
  shouldFireComplete(): boolean;
};

export function createSurveyAnalyticsLatch(): SurveyAnalyticsLatch {
  const firedQuestions = new Set<string>();
  let completeFired = false;
  return {
    shouldFireQuestion(question, answer) {
      const key = `${question}:${answer}`;
      if (firedQuestions.has(key)) return false;
      firedQuestions.add(key);
      return true;
    },
    shouldFireComplete() {
      if (completeFired) return false;
      completeFired = true;
      return true;
    },
  };
}
