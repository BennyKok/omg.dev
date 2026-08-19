import { describe, expect, test } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import {
  answerCursorPlan,
  answerCursorQuestions,
  registerCursorExtensionHandlers,
} from "./cursor-acp-extensions.ts";
import type { ManagedSdkEventSink } from "./managed-sdk-session.ts";

function sinkWithAnswers(...answers: Array<number | null>): ManagedSdkEventSink {
  return {
    draft() {},
    thinking() {},
    commitText() {},
    toolStart() {},
    toolEnd() {},
    async ask() {
      return answers.shift() ?? null;
    },
  };
}

describe("Cursor ACP extension handlers", () => {
  test("maps each Cursor question to the shared prompt answer", async () => {
    const response = await answerCursorQuestions({
      toolCallId: "call-1",
      title: "Choose",
      questions: [
        { id: "q1", prompt: "Mode?", options: [{ id: "agent", label: "Agent" }, { id: "plan", label: "Plan" }] },
        { id: "q2", prompt: "Scope?", options: [{ id: "small", label: "Small" }, { id: "large", label: "Large" }] },
      ],
    }, sinkWithAnswers(1, 0));

    expect(response).toEqual({
      outcome: {
        outcome: "answered",
        answers: [
          { questionId: "q1", selectedOptionIds: ["plan"] },
          { questionId: "q2", selectedOptionIds: ["small"] },
        ],
      },
    });
  });

  test("maps plan approval and rejection to Cursor responses", async () => {
    const request = { toolCallId: "call-2", name: "Plan", plan: "1. Test it." };
    await expect(answerCursorPlan(request, sinkWithAnswers(0))).resolves.toEqual({
      outcome: { outcome: "accepted" },
    });
    await expect(answerCursorPlan(request, sinkWithAnswers(1))).resolves.toEqual({
      outcome: { outcome: "rejected", reason: "The user rejected this plan in LFG." },
    });
  });

  test("cancels a blocking extension when the prompt is dismissed", async () => {
    await expect(answerCursorQuestions({
      toolCallId: "call-3",
      questions: [{ id: "q1", prompt: "Continue?", options: [{ id: "yes", label: "Yes" }] }],
    }, sinkWithAnswers(null))).resolves.toEqual({ outcome: { outcome: "cancelled" } });
  });

  test("answers Cursor's custom request across the ACP connection", async () => {
    let response: Record<string, unknown> | null = null;
    const agent = acp.agent({ name: "cursor-extension-test-agent" })
      .onRequest(acp.methods.agent.initialize, ({ params }) => ({
        protocolVersion: params.protocolVersion,
        agentCapabilities: { loadSession: false },
        authMethods: [],
      }))
      .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "cursor-test-session" }))
      .onRequest(acp.methods.agent.session.prompt, async ({ client }) => {
        response = await client.request("cursor/ask_question", {
          toolCallId: "call-wire",
          questions: [{
            id: "q-wire",
            prompt: "Choose over ACP",
            options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
          }],
        });
        return { stopReason: "end_turn" };
      });
    const client = registerCursorExtensionHandlers(
      acp.client({ name: "cursor-extension-test-client" }),
      sinkWithAnswers(1),
    );

    await client.connectWith(agent, async (context) => {
      await context.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const session = await context.request(acp.methods.agent.session.new, {
        cwd: "/tmp",
        mcpServers: [],
      });
      await context.request(acp.methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "test" }],
      });
    });

    expect(response as unknown).toEqual({
      outcome: {
        outcome: "answered",
        answers: [{ questionId: "q-wire", selectedOptionIds: ["no"] }],
      },
    });
  });
});
