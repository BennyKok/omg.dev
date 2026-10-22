import { describe, expect, test } from "bun:test";
import { sessionPreview } from "../mobile/src/omg/session-preview";
import { isMachineryPreviewText, prosePreviewText, promptPreviewText } from "../web/src/lib/transcript-status";
import { classifyUserTurn } from "../web/src/lib/system-message";
import { classifySystemMessage as phoneClassify } from "../mobile/src/omg/system-message";

// A hosted customer saw "Build a gamified to-do list game === omg.dev RUNTIME
// CONTRACT ..." as a session row preview (2026-10-21). Every preview path, web
// and phone, must show the person's task and none of the launch envelope.
const task = "Build a gamified to-do list game";
const wrapped = [
  "=== omg.dev RUNTIME CONTRACT (capability version 2026-10-19.2) ===",
  "You are an omg.dev-managed coding agent.",
  "=== END omg.dev RUNTIME CONTRACT ===",
  "",
  "=== USER STANDING INSTRUCTIONS ===",
  "Always answer in French.",
  "=== END USER STANDING INSTRUCTIONS ===",
  "",
  "=== USER TASK ===",
  "=== omg.dev FIRST RUN ===",
  "This session is a new user's first task on omg.dev.",
  "=== USER TASK ===",
  task,
].join("\n");

const leaked = /RUNTIME CONTRACT|STANDING INSTRUCTIONS|FIRST RUN|USER TASK|omg\.dev-managed|French/;

describe("session previews never show the launch envelope", () => {
  test("web preview text is the task alone", () => {
    expect(prosePreviewText(wrapped)).toBe(task);
    expect(promptPreviewText(wrapped)).toBe(task);
    expect(promptPreviewText(`[Tue 2026-10-21 09:14] ${wrapped}`)).toBe(task);
  });

  test("phone row preview is the task alone, from the last turn or the last user text", () => {
    expect(sessionPreview({ last: { role: "user", kind: "text", text: wrapped } })).toBe(task);
    expect(sessionPreview({ last: null, lastUserText: wrapped })).toBe(task);
    expect(sessionPreview({ last: { role: "user", kind: "text", text: wrapped } })).not.toMatch(leaked);
  });
});

// The hosted control plane resumes a session with "[omg builder] ..." to make
// the agent finish. A customer saw it as a message she had sent.
describe("an omg.dev builder follow-up is a machine turn", () => {
  const nudge =
    "[omg builder] The app is not published yet, so the person who paid for it has no link to open. Finish the original task in this session now.";

  test("web and phone both classify it as a system message", () => {
    expect(classifyUserTurn(nudge)).not.toBeNull();
    expect(phoneClassify(nudge)).not.toBeNull();
  });

  test("it never becomes a row preview", () => {
    expect(isMachineryPreviewText(nudge)).toBe(true);
    expect(sessionPreview({ last: { role: "user", kind: "text", text: nudge }, lastUserText: task })).toBe(task);
  });
});
