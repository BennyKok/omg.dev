import { describe, expect, test } from "bun:test";
import { readPromptDraft, stashPromptDraft } from "./prompt-stash";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("prompt stash session handoff", () => {
  test("keeps a Design Mode result as an unsent draft for one session", () => {
    const storage = memoryStorage();
    const stored = stashPromptDraft(
      {
        contextKey: "session:11111111-1111-4111-8111-111111111111",
        source: "session",
        text: "Selected context\n\nWhat I want changed:",
        sessionId: "11111111-1111-4111-8111-111111111111",
        sessionTitle: "Checkout repair",
        project: "shop",
      },
      storage,
    );

    expect(stored?.status).toBe("draft");
    expect(
      readPromptDraft("session:11111111-1111-4111-8111-111111111111", storage),
    ).toMatchObject({
      text: "Selected context\n\nWhat I want changed:",
      status: "draft",
      sessionTitle: "Checkout repair",
    });
    expect(readPromptDraft("session:another", storage)).toBeNull();
  });
});
