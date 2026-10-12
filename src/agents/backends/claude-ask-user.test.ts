import { describe, expect, test } from "bun:test";
import type { AisdkPrompt } from "../../aisdk-registry.ts";
import {
  DISMISSED_MESSAGE,
  answerForText,
  createClaudeAskBridge,
  readAskUserQuestions,
} from "./claude-ask-user.ts";

const input = {
  questions: [
    {
      question: "Ship the fix now?",
      header: "Ship",
      multiSelect: false,
      options: [
        { label: "Yes", description: "Push to main" },
        { label: "No", description: "Keep it local" },
      ],
    },
  ],
};

function harness() {
  const shown: Array<AisdkPrompt | null> = [];
  const bridge = createClaudeAskBridge({ show: (p) => shown.push(p) });
  return { bridge, shown };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function answersOf(result: Awaited<ReturnType<ReturnType<typeof createClaudeAskBridge>["ask"]>>) {
  if (result.behavior !== "allow") throw new Error(`expected allow, got ${result.behavior}`);
  return result.updatedInput.answers as Record<string, string>;
}

describe("claude AskUserQuestion bridge", () => {
  test("shows the question with its options and descriptions", async () => {
    const { bridge, shown } = harness();
    const result = bridge.ask(input);
    await tick();
    expect(bridge.waiting).toBe(true);
    expect(shown[0]).toEqual({
      question: "Ship the fix now?",
      header: "Ship",
      options: [
        { index: 0, label: "Yes", selected: false, description: "Push to main" },
        { index: 1, label: "No", selected: false, description: "Keep it local" },
      ],
    });
    expect(bridge.answerIndex(1)).toBe(true);
    expect(await result).toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { "Ship the fix now?": "No" } },
    });
    expect(shown.at(-1)).toBeNull();
    expect(bridge.waiting).toBe(false);
  });

  test("typed text answers: an exact label picks the option, other text is a custom answer", async () => {
    const q = readAskUserQuestions(input)[0]!;
    expect(answerForText(q, "  yes ")).toBe("Yes");
    expect(answerForText(q, "Only after tests pass")).toBe("Only after tests pass");

    const { bridge } = harness();
    const result = bridge.ask(input);
    await tick();
    expect(bridge.answerText("Only after tests pass")).toBe(true);
    expect(answersOf(await result)).toEqual({
      "Ship the fix now?": "Only after tests pass",
    });
  });

  test("several questions are asked one at a time", async () => {
    const { bridge, shown } = harness();
    const two = {
      questions: [
        input.questions[0],
        { question: "Which branch?", header: "Branch", multiSelect: false, options: [{ label: "main", description: "" }, { label: "dev", description: "" }] },
      ],
    };
    const result = bridge.ask(two);
    await tick();
    bridge.answerIndex(0);
    await tick();
    expect(shown.filter(Boolean).map((p) => p!.question)).toEqual(["Ship the fix now?", "Which branch?"]);
    bridge.answerText("dev");
    expect(answersOf(await result)).toEqual({ "Ship the fix now?": "Yes", "Which branch?": "dev" });
  });

  test("dismiss and abort deny the tool call", async () => {
    const { bridge } = harness();
    const dismissed = bridge.ask(input);
    await tick();
    expect(bridge.dismiss()).toBe(true);
    expect(await dismissed).toEqual({ behavior: "deny", message: DISMISSED_MESSAGE });

    const abort = new AbortController();
    const aborted = bridge.ask(input, abort.signal);
    await tick();
    abort.abort();
    expect((await aborted).behavior).toBe("deny");
    expect(bridge.waiting).toBe(false);
  });

  test("answers with nothing open do nothing", () => {
    const { bridge, shown } = harness();
    expect(bridge.answerIndex(0)).toBe(false);
    expect(bridge.answerText("yes")).toBe(false);
    expect(bridge.dismiss()).toBe(false);
    expect(shown).toEqual([]);
  });

  test("an out-of-range index leaves the question open", async () => {
    const { bridge } = harness();
    void bridge.ask(input);
    await tick();
    expect(bridge.answerIndex(5)).toBe(false);
    expect(bridge.waiting).toBe(true);
    bridge.dismiss();
  });
});
