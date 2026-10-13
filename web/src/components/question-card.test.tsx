import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "../lib/omg-client";

const { SessionPromptPanel, QuestionChoices } = await import("./question-card");
const { AskProvider, SessionQuestionPanel } = await import("./ask-center");

let ui: Mounted;
const originalFetch = globalThis.fetch;
let calls: { url: string; body: unknown }[];
let open: Record<string, unknown>[];

// Ask questions render through Streamdown, which reads process.cwd(). In the
// full suite an earlier test can leave the process in a deleted directory
// (see streamdown-session-ref.test.tsx), so pin one that exists.
beforeAll(() => process.chdir(import.meta.dir));

beforeEach(() => {
  ui = mount();
  calls = [];
  open = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    if (url.includes("/api/ask?status=open")) return Response.json({ questions: open });
    return Response.json({ ok: true });
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
});

const SID = "11111111-2222-4333-8444-555555555555";

const choiceButtons = () => ui.queryAll<HTMLButtonElement>("button[data-choice]");

test("a harness prompt shows lettered, full-width answers with descriptions", () => {
  ui.render(
    <SessionPromptPanel
      sid={SID}
      onError={() => {}}
      prompt={{
        question: "Ship the fix now?",
        header: "Ship",
        options: [
          { index: 0, label: "Yes", description: "Push to main", selected: true },
          { index: 1, label: "No", description: "Keep it local" },
        ],
      }}
    />,
  );
  const buttons = choiceButtons();
  expect(buttons.map((b) => b.dataset.choice)).toEqual(["A", "B"]);
  expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["A. Yes", "B. No"]);
  expect(ui.text()).toContain("Ship the fix now?");
  expect(ui.text()).toContain("Push to main");
  expect(ui.text()).toContain("Ship");
  // No filler: no default label, no "type your own answer" line.
  expect(ui.text()).not.toContain("Needs your input");
  expect(ui.text()).not.toContain("Or type your own answer");
  // A TUI cursor row is not a choice the person made.
  expect(buttons[0]!.className).not.toContain("border-primary bg-muted");
});

test("tapping an answer posts its option index and locks the card", async () => {
  ui.render(
    <SessionPromptPanel
      sid={SID}
      onError={() => {}}
      prompt={{ question: "Pick", options: [{ index: 1, label: "One" }, { index: 2, label: "Two" }] }}
    />,
  );
  choiceButtons()[1]!.click();
  await ui.flushAsync();
  expect(calls.find((c) => c.url.endsWith(`/api/sessions/${SID}/answer`))?.body).toEqual({ index: 2 });
  expect(choiceButtons().every((b) => b.disabled)).toBe(true);
});

test("an ask-user question in the session uses the same lettered answers", async () => {
  open = [{ id: "abc123", question: "Deploy to production?", options: ["Yes", "Not yet"], sessionId: "s1", createdAt: Date.now() }];
  ui.render(
    <AskProvider>
      <SessionQuestionPanel sessionIds={["s1"]} />
    </AskProvider>,
  );
  await ui.flushAsync();
  expect(choiceButtons().map((b) => b.getAttribute("aria-label"))).toEqual(["A. Yes", "B. Not yet"]);
  choiceButtons()[1]!.click();
  await ui.flushAsync();
  expect(calls.find((c) => c.url.endsWith("/api/ask/abc123/answer"))?.body).toEqual(
    expect.objectContaining({ answer: "Not yet" }),
  );
});

test("no options renders no list", () => {
  ui.render(<QuestionChoices choices={[]} onPick={() => {}} />);
  expect(ui.query("ol")).toBeNull();
});
