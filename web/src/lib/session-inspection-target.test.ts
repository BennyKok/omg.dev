import { describe, expect, test } from "bun:test";
import {
  fetchSessionInspectionUrl,
  readSessionInspectionTarget,
  resolveSessionInspectionUrl,
  stashSessionInspectionTarget,
} from "./session-inspection-target";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("session inspection target", () => {
  test("prefers the latest URL supplied by the person over unrelated assistant links", () => {
    expect(
      resolveSessionInspectionUrl(
        [
          { role: "user", text: "Can you inspect https://x.com/blendibyl/status/2094216957734355275?s=46" },
          { role: "assistant", text: "I opened https://github.com/BennyKok/omg.dev/pull/252" },
        ],
        "https://x.com/blendibyl/status/2094216957734355275",
      ),
    ).toBe("https://x.com/blendibyl/status/2094216957734355275?s=46");
  });

  test("falls back to a valid URL title and rejects non-web schemes", () => {
    expect(resolveSessionInspectionUrl([], "https://example.test/checkout?step=2")).toBe(
      "https://example.test/checkout?step=2",
    );
    expect(resolveSessionInspectionUrl([{ role: "user", text: "file:///etc/passwd" }], "No URL"))
      .toBeNull();
  });

  test("re-reads a long transcript instead of navigating to a clipped title URL", async () => {
    const requested: string[] = [];
    const resolved = await fetchSessionInspectionUrl(
      "session/long",
      [{ role: "user", text: "latest follow-up without a URL" }],
      async (input) => {
        requested.push(input);
        return {
          ok: true,
          text: async () => "",
          json: async () => ({
            messages: [
              {
                role: "user",
                text: "Original task: inspect https://github.com/stablyai/orca",
              },
              { role: "assistant", text: "Later PR: https://github.com/BennyKok/omg.dev/pull/252" },
            ],
          }),
        } as Pick<Response, "ok" | "json" | "text">;
      },
    );

    expect(requested[0]).toContain("/api/sessions/session%2Flong/messages?");
    expect(resolved).toBe("https://github.com/stablyai/orca");
  });

  test("stores the page target outside browser history and consumes it for one session", () => {
    const storage = new MemoryStorage();
    stashSessionInspectionTarget(
      "session-a",
      "https://example.test/page?view=mobile",
      storage,
    );
    expect(readSessionInspectionTarget("session-b", storage)).toBeNull();
    expect(readSessionInspectionTarget("session-a", storage)).toBe(
      "https://example.test/page?view=mobile",
    );
  });
});
