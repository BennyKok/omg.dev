import { describe, expect, test } from "bun:test";
import type { CustomProvider } from "./custom-models.ts";
import {
  CLAUDE_TITLE_MODEL,
  cleanGeneratedSessionTitle,
  generateSessionTitle,
  pickSessionTitleModel,
  TITLE_SYSTEM_PROMPT,
} from "./session-auto-title.ts";

const providers: CustomProvider[] = [
  { id: "pc", baseURL: "http://gpu.local:8000/v1", models: [{ id: "gemma", input: ["text"] }] },
  { id: "modal", baseURL: "https://x.modal.run/v1", apiKey: "k-1", models: [{ id: "deepseek", input: ["text"] }] },
];
const allOnline = { "custom-pc/gemma": { online: true }, "custom-modal/deepseek": { online: true } };

describe("pickSessionTitleModel", () => {
  test("the selected custom model wins when it is online", () => {
    expect(pickSessionTitleModel({
      selected: ["", "custom-modal/deepseek"],
      providers,
      online: allOnline,
      claudeInstalled: true,
    })).toEqual({ kind: "custom", id: "custom-modal/deepseek", baseURL: "https://x.modal.run/v1", apiKey: "k-1", model: "deepseek" });
  });

  test("a selected Claude model, or an offline custom one, falls to Claude haiku", () => {
    for (const selected of [["opus"], ["custom-pc/gemma"]]) {
      expect(pickSessionTitleModel({
        selected,
        providers,
        online: { "custom-pc/gemma": { online: false } },
        claudeInstalled: true,
      })).toEqual({ kind: "claude", model: CLAUDE_TITLE_MODEL });
    }
  });

  test("without Claude, the first online custom model in file order", () => {
    expect(pickSessionTitleModel({
      selected: ["opus"],
      providers,
      online: { "custom-pc/gemma": { online: false }, "custom-modal/deepseek": { online: true } },
      claudeInstalled: false,
    })).toMatchObject({ kind: "custom", id: "custom-modal/deepseek" });
  });

  test("nothing installed and nothing online means no model", () => {
    expect(pickSessionTitleModel({ selected: [], providers, online: {}, claudeInstalled: false })).toBeNull();
    expect(pickSessionTitleModel({ selected: [], providers: [], online: {}, claudeInstalled: false })).toBeNull();
  });
});

describe("generateSessionTitle", () => {
  test("calls the custom model's own endpoint with its key and a redacted, wrapped request", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const title = await generateSessionTitle("Please fix the mobile session list overflow. key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh", {
      target: { kind: "custom", id: "custom-modal/deepseek", baseURL: "https://x.modal.run/v1", apiKey: "k-1", model: "deepseek" },
      fetch: async (url, init) => {
        calls.push({ url, init: init! });
        return Response.json({ choices: [{ message: { content: "<think>hmm</think>\n\"Fix Mobile Session Overflow.\"" } }] });
      },
    });
    expect(title).toBe("Fix Mobile Session Overflow");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://x.modal.run/v1/chat/completions");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer k-1");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe("deepseek");
    expect(body.messages[0]).toEqual({ role: "system", content: TITLE_SYSTEM_PROMPT });
    expect(body.messages[1].content).toStartWith("<request>\nPlease fix the mobile session list overflow");
    expect(body.messages[1].content).not.toContain("sk-ant-api03-ABCDEFGH");
  });

  test("an error status or a thrown fetch keeps the old title", async () => {
    const target = { kind: "custom", id: "custom-pc/gemma", baseURL: "http://gpu.local:8000/v1", model: "gemma" } as const;
    expect(await generateSessionTitle("Fix it", { target, fetch: async () => new Response("down", { status: 503 }) })).toBeNull();
    expect(await generateSessionTitle("Fix it", { target, fetch: async () => { throw new Error("refused"); } })).toBeNull();
  });

  test("the Claude path gets the cleaned request and its reply is cleaned", async () => {
    const seen: string[] = [];
    const title = await generateSessionTitle("Diagnose   the launch failure", {
      target: { kind: "claude", model: "haiku" },
      claude: async (_target, task) => {
        seen.push(task);
        return cleanGeneratedSessionTitle("Title: Diagnose Launch Failure");
      },
    });
    expect(seen).toEqual(["Diagnose the launch failure"]);
    expect(title).toBe("Diagnose Launch Failure");
  });

  test("no model, or an empty prompt, never calls anything", async () => {
    let called = false;
    const fetch = async () => { called = true; return Response.json({}); };
    expect(await generateSessionTitle("Fix it", { target: null, fetch })).toBeNull();
    expect(await generateSessionTitle("   ", { target: { kind: "claude", model: "haiku" }, fetch })).toBeNull();
    expect(called).toBe(false);
  });
});

describe("cleanGeneratedSessionTitle", () => {
  test("rejects an answer that came back in place of a title", () => {
    expect(cleanGeneratedSessionTitle("Sure! Here is a long explanation of what went wrong with the build and how to fix it today")).toBeNull();
    expect(cleanGeneratedSessionTitle("<think>draft</think> Title: \"Repair session titles.\"")).toBe("Repair session titles");
    expect(cleanGeneratedSessionTitle("**Repair Session Titles**")).toBe("Repair Session Titles");
    expect(cleanGeneratedSessionTitle(null)).toBeNull();
  });
});
