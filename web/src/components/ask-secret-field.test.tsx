import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "../lib/omg-client";

const { AskProvider, QuestionNotification, SessionQuestionPanel, useAsk } = await import("./ask-center");

let ui: Mounted;
const originalFetch = globalThis.fetch;
let calls: { url: string; body: unknown }[];
let open: Record<string, unknown>[];

const SECRET = {
  id: "abc123",
  question: "Enter FISH_AUDIO_API_KEY (fish.audio > API Keys)",
  sessionId: "s1",
  secret: { key: "FISH_AUDIO_API_KEY" },
  createdAt: Date.now(),
};

beforeEach(() => {
  ui = mount();
  calls = [];
  open = [SECRET];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    if (url.includes("/api/ask?status=open")) return Response.json({ questions: open });
    if (url.endsWith("/secret")) {
      open = [];
      return Response.json({ question: { id: SECRET.id }, saved: { key: "FISH_AUDIO_API_KEY", cloud: "set" } });
    }
    return Response.json({});
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test("a key request in the session shows a password field and saves through /secret", async () => {
  ui.render(
    <AskProvider>
      <SessionQuestionPanel sessionIds={["s1"]} />
    </AskProvider>,
  );
  await ui.flushAsync();
  const input = ui.query<HTMLInputElement>('input[type="password"]');
  expect(input).not.toBeNull();
  expect(ui.text()).toContain("FISH_AUDIO_API_KEY");

  setInput(input!, "fa_secret_1");
  await ui.flushAsync();
  ui.query<HTMLButtonElement>('button[type="submit"]')!.click();
  await ui.flushAsync();

  const secretCalls = calls.filter((c) => c.url.endsWith("/api/ask/abc123/secret"));
  expect(secretCalls).toEqual([{ url: expect.stringContaining("/api/ask/abc123/secret"), body: { value: "fa_secret_1" } }]);
  expect(calls.some((c) => c.url.includes("/answer"))).toBe(false);
  expect(ui.query('input[type="password"]')).toBeNull();
});

test("a message typed in the session composer does not resolve a key request", async () => {
  let answerInSession: ((q: typeof SECRET, text: string) => Promise<void>) | null = null;
  function Probe() {
    answerInSession = useAsk().answerInSession as typeof answerInSession;
    return null;
  }
  ui.render(
    <AskProvider>
      <Probe />
    </AskProvider>,
  );
  await ui.flushAsync();
  await answerInSession!(SECRET, "fa_secret_1");
  expect(calls.some((c) => c.url.includes("/answer"))).toBe(false);
});

const PLAIN = { id: "def456", question: "Ship now or wait?", sessionId: "s1", createdAt: Date.now() };

test("an ordinary question inside its session has no reply box of its own", async () => {
  open = [PLAIN];
  ui.render(
    <AskProvider>
      <SessionQuestionPanel sessionIds={["s1"]} />
    </AskProvider>,
  );
  await ui.flushAsync();
  expect(ui.text()).toContain("Ship now or wait?");
  expect(ui.query("textarea")).toBeNull();
  expect(ui.query('input[type="password"]')).toBeNull();
});

test("the same question in the Notification Center has a reply box", async () => {
  ui.render(
    <AskProvider>
      <QuestionNotification q={PLAIN} compactPreview={false} />
    </AskProvider>,
  );
  await ui.flushAsync();
  expect(ui.query("textarea")).not.toBeNull();
});

test("the preview keeps underscores inside a key name and still strips emphasis", async () => {
  const { stripMd } = await import("./ask-center");
  expect(stripMd("Enter FISH_AUDIO_API_KEY (fish.audio)")).toBe("Enter FISH_AUDIO_API_KEY (fish.audio)");
  expect(stripMd("Use `MY_KEY` or _this_ or **that**")).toBe("Use MY_KEY or this or that");
});
