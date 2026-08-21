import type { ClientApp } from "@agentclientprotocol/sdk";
import type { ManagedSdkEventSink } from "./managed-sdk-session.ts";

export type CursorAskQuestionRequest = {
  toolCallId: string;
  title?: string;
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
    allowMultiple?: boolean;
  }>;
};

export type CursorAskQuestionResponse = {
  outcome:
    | { outcome: "answered"; answers: Array<{ questionId: string; selectedOptionIds: string[] }> }
    | { outcome: "skipped"; reason?: string }
    | { outcome: "cancelled" };
};

export type CursorCreatePlanRequest = {
  toolCallId: string;
  name?: string;
  overview?: string;
  plan: string;
};

export type CursorCreatePlanResponse = {
  outcome:
    | { outcome: "accepted"; planUri?: string }
    | { outcome: "rejected"; reason?: string }
    | { outcome: "cancelled" };
};

function recordParams<T>(value: unknown): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cursor ACP extension parameters must be an object");
  }
  return value as T;
}

export async function answerCursorQuestions(
  params: CursorAskQuestionRequest,
  sink: ManagedSdkEventSink,
): Promise<CursorAskQuestionResponse> {
  if (!Array.isArray(params.questions) || !params.questions.length) {
    return { outcome: { outcome: "skipped", reason: "Cursor supplied no questions." } };
  }
  const answers: Array<{ questionId: string; selectedOptionIds: string[] }> = [];
  for (const question of params.questions) {
    if (!Array.isArray(question.options) || !question.options.length) {
      return { outcome: { outcome: "skipped", reason: `Cursor supplied no options for ${question.id}.` } };
    }
    const selected = await sink.ask(
      question.prompt,
      question.options.map((option) => ({ label: option.label, value: option.id })),
      params.title ?? "Cursor question",
    );
    if (selected == null) return { outcome: { outcome: "cancelled" } };
    const option = question.options[selected];
    if (!option) return { outcome: { outcome: "cancelled" } };
    // The shared prompt surface selects one option. One selection is a valid
    // answer even when Cursor allows multiple choices.
    answers.push({ questionId: question.id, selectedOptionIds: [option.id] });
  }
  return { outcome: { outcome: "answered", answers } };
}

export async function answerCursorPlan(
  params: CursorCreatePlanRequest,
  sink: ManagedSdkEventSink,
): Promise<CursorCreatePlanResponse> {
  const body = [params.overview, params.plan].filter(Boolean).join("\n\n");
  const selected = await sink.ask(
    body || "Cursor requested plan approval.",
    [
      { label: "Accept plan" },
      { label: "Reject plan" },
    ],
    params.name ?? "Cursor plan",
  );
  if (selected == null) return { outcome: { outcome: "cancelled" } };
  if (selected === 0) return { outcome: { outcome: "accepted" } };
  return { outcome: { outcome: "rejected", reason: "The user rejected this plan in LFG." } };
}

/** Register Cursor's two blocking ACP extension methods. */
export function registerCursorExtensionHandlers(
  app: ClientApp,
  sink: ManagedSdkEventSink,
): ClientApp {
  return app
    .onRequest<CursorAskQuestionRequest, CursorAskQuestionResponse>(
      "cursor/ask_question",
      recordParams,
      ({ params }) => answerCursorQuestions(params, sink),
    )
    .onRequest<CursorCreatePlanRequest, CursorCreatePlanResponse>(
      "cursor/create_plan",
      recordParams,
      ({ params }) => answerCursorPlan(params, sink),
    );
}
