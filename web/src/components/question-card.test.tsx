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

const settle = () => ui.flushAsync(() => new Promise((resolve) => setTimeout(resolve, 20)));

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
  // Just the question: no header, no default label, no hint line.
  expect(ui.query(".question-card")?.textContent?.startsWith("Ship the fix now?")).toBe(true);
  expect(ui.text()).not.toContain("Needs your input");
  expect(ui.text()).not.toContain("Or type your own answer");
  // A TUI cursor row is not a choice the person made.
  expect(buttons[0]!.className).not.toMatch(/(^| )bg-muted( |$)/);
});

test("tapping an answer hides the card at once and posts its option index", async () => {
  // Hold the answer request open: the card must go before the server replies.
  let release!: () => void;
  const answered = new Promise<void>((resolve) => (release = resolve));
  const plainFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = plainFetch(input, init);
    if (String(input instanceof Request ? input.url : input).endsWith("/answer")) await answered;
    return response;
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());
  ui.render(
    <SessionPromptPanel
      sid={SID}
      onError={() => {}}
      prompt={{ question: "Pick", options: [{ index: 1, label: "One" }, { index: 2, label: "Two" }] }}
    />,
  );
  choiceButtons()[1]!.click();
  await ui.flushAsync();
  expect(ui.query(".question-card")).toBeNull();
  expect(calls.find((c) => c.url.endsWith(`/api/sessions/${SID}/answer`))?.body).toEqual({ index: 2 });
  release();
  await ui.flushAsync();
  expect(ui.query(".question-card")).toBeNull();
});

test("a failed answer brings the card back with the error", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push({ url: String(input), body: null });
    return Response.json({ error: "answer failed" }, { status: 400 });
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());
  const errors: (string | null)[] = [];
  ui.render(
    <SessionPromptPanel
      sid={SID}
      onError={(e) => errors.push(e)}
      prompt={{ question: "Pick", options: [{ index: 0, label: "One" }] }}
    />,
  );
  choiceButtons()[0]!.click();
  await settle();
  expect(ui.query(".question-card")).not.toBeNull();
  expect(errors.at(-1)).toBeTruthy();
});

test("a composer send hides the open prompt, and a new prompt shows", async () => {
  const pick = { question: "Pick", options: [{ index: 0, label: "One" }] };
  const view = (seq: number, prompt: typeof pick | null) => (
    <SessionPromptPanel sid={SID} onError={() => {}} prompt={prompt} composerSendSeq={seq} />
  );
  ui.render(view(0, pick));
  expect(ui.query(".question-card")).not.toBeNull();
  ui.render(view(1, pick));
  await ui.flushAsync();
  expect(ui.query(".question-card")).toBeNull();
  // The server clears it; a later question with the same words is new.
  ui.render(view(1, null));
  ui.render(view(1, pick));
  await ui.flushAsync();
  expect(ui.query(".question-card")).not.toBeNull();
});

test("an answer counts as a running turn until the server clears the prompt", async () => {
  // The agent waits on a question as idle. The answer resumes its turn at
  // once, so the chat must not read idle until the cleared prompt arrives:
  // a queued send in that gap was drawn as a sent bubble the server held.
  const reports: boolean[] = [];
  const onAnsweringChange = (answering: boolean) => reports.push(answering);
  const pick = { question: "Stop the emulator?", options: [{ index: 0, label: "Yes" }] };
  const view = (prompt: typeof pick | null) => (
    <SessionPromptPanel sid={SID} onError={() => {}} prompt={prompt} onAnsweringChange={onAnsweringChange} />
  );
  ui.render(view(pick));
  expect(reports.at(-1)).toBe(false);
  choiceButtons()[0]!.click();
  await settle();
  expect(reports.at(-1)).toBe(true);
  // The server clears the prompt (with its busy state in the same frame).
  ui.render(view(null));
  await ui.flushAsync();
  expect(reports.at(-1)).toBe(false);
});

test("a failed answer does not leave the turn counted as running", async () => {
  globalThis.fetch = (async () => Response.json({ error: "answer failed" }, { status: 400 })) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());
  const reports: boolean[] = [];
  ui.render(
    <SessionPromptPanel
      sid={SID}
      onError={() => {}}
      prompt={{ question: "Pick", options: [{ index: 0, label: "One" }] }}
      onAnsweringChange={(answering) => reports.push(answering)}
    />,
  );
  choiceButtons()[0]!.click();
  await settle();
  expect(reports).toContain(true);
  expect(reports.at(-1)).toBe(false);
  expect(ui.query(".question-card")).not.toBeNull();
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
  expect(ui.query(".question-card")).toBeNull();
});

test("an answered ask leaves at once and a stale poll does not bring it back", async () => {
  open = [{ id: "abc123", question: "Deploy?", options: ["Yes"], sessionId: "s1", createdAt: Date.now() }];
  let release!: () => void;
  const answered = new Promise<void>((resolve) => (release = resolve));
  const plainFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = plainFetch(input, init);
    if (String(input instanceof Request ? input.url : input).endsWith("/answer")) await answered;
    return response;
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());
  ui.render(
    <AskProvider>
      <SessionQuestionPanel sessionIds={["s1"]} />
    </AskProvider>,
  );
  await settle();
  choiceButtons()[0]!.click();
  await ui.flushAsync();
  expect(ui.query(".question-card")).toBeNull();
  // A poll while the answer is in flight still lists the question.
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(ui.query(".question-card")).toBeNull();
  release();
  await ui.flushAsync();
});

test("a failed ask answer puts the question back", async () => {
  open = [{ id: "abc123", question: "Deploy?", options: ["Yes"], sessionId: "s1", createdAt: Date.now() }];
  const plainFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input instanceof Request ? input.url : input).endsWith("/answer")) {
      return new Response("nope", { status: 500 });
    }
    return plainFetch(input, init);
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());
  ui.render(
    <AskProvider>
      <SessionQuestionPanel sessionIds={["s1"]} />
    </AskProvider>,
  );
  await settle();
  choiceButtons()[0]!.click();
  await settle();
  expect(ui.query(".question-card")).not.toBeNull();
});

test("no options renders no list", () => {
  ui.render(<QuestionChoices choices={[]} onPick={() => {}} />);
  expect(ui.query("ol")).toBeNull();
});
