import { describe, expect, test } from "bun:test";
import {
  analyticsMessage,
  LFG_ANALYTICS_MESSAGE,
  originOf,
  postAnalyticsToHost,
  postSessionCreatedToHost,
  resolveHostOrigin,
  sessionCreatedMessage,
} from "./embed-host-signal";

// This module is the only place LFG talks to the embedding host. The
// requirement that matters most for `lfg:analytics`: a dropped or blocked
// message must never surface in onboarding or block the flow — the caller
// always gets a clean boolean back, never a thrown error.

describe("analyticsMessage", () => {
  test("shape matches the documented lfg:analytics contract", () => {
    expect(analyticsMessage("onboarding_survey_question", { question: "identity", answer: "founder" })).toEqual({
      type: "lfg:analytics",
      event: "onboarding_survey_question",
      props: { question: "identity", answer: "founder" },
    });
  });

  test("omits props entirely rather than sending props: undefined", () => {
    const msg = analyticsMessage("onboarding_survey_complete");
    expect(msg).toEqual({ type: LFG_ANALYTICS_MESSAGE, event: "onboarding_survey_complete" });
    expect("props" in msg).toBe(false);
  });
});

describe("postAnalyticsToHost — fire-and-forget guarantees", () => {
  const origin = "https://host.example";

  test("posts the analytics message to the resolved origin when every guard passes", () => {
    const sent: Array<{ message: unknown; targetOrigin: string }> = [];
    const parent = { postMessage: (message: unknown, targetOrigin: string) => sent.push({ message, targetOrigin }) };
    const ok = postAnalyticsToHost(
      "onboarding_survey_question",
      { question: "pain", answer: "waiting" },
      { embedded: true, parent, self: {}, origin },
    );
    expect(ok).toBe(true);
    expect(sent).toEqual([
      {
        message: { type: "lfg:analytics", event: "onboarding_survey_question", props: { question: "pain", answer: "waiting" } },
        targetOrigin: origin,
      },
    ]);
  });

  test("a throwing postMessage (blocked/misbehaving host) never throws out, just returns false", () => {
    const parent = {
      postMessage: () => {
        throw new Error("blocked");
      },
    };
    expect(() =>
      postAnalyticsToHost("onboarding_survey_complete", { identity: "founder", pain: "skipped" }, {
        embedded: true,
        parent,
        self: {},
        origin,
      }),
    ).not.toThrow();
    expect(
      postAnalyticsToHost("onboarding_survey_complete", undefined, { embedded: true, parent, self: {}, origin }),
    ).toBe(false);
  });

  test("not embedded: no post, no throw", () => {
    const parent = { postMessage: () => {
      throw new Error("should never be called");
    } };
    expect(postAnalyticsToHost("onboarding_survey_question", { question: "identity", answer: "founder" }, {
      embedded: false,
      parent,
      self: {},
      origin,
    })).toBe(false);
  });

  test("no parent window: no post, no throw", () => {
    expect(postAnalyticsToHost("onboarding_survey_question", undefined, { embedded: true, parent: null, self: {}, origin })).toBe(
      false,
    );
  });

  test("parent is self (not actually framed): no post, no throw", () => {
    const same = { postMessage: () => {
      throw new Error("should never be called");
    } };
    expect(
      postAnalyticsToHost("onboarding_survey_question", undefined, {
        embedded: true,
        parent: same,
        self: same,
        origin,
      }),
    ).toBe(false);
  });

  test("no resolved host origin: no post, no throw", () => {
    const parent = { postMessage: () => {
      throw new Error("should never be called");
    } };
    expect(
      postAnalyticsToHost("onboarding_survey_question", undefined, { embedded: true, parent, self: {}, origin: null }),
    ).toBe(false);
  });

  test("empty event name: no post, no throw", () => {
    const parent = { postMessage: () => {
      throw new Error("should never be called");
    } };
    expect(postAnalyticsToHost("", undefined, { embedded: true, parent, self: {}, origin })).toBe(false);
  });
});

// Sanity: postSessionCreatedToHost shares the same guard shape, unchanged by
// adding the analytics message type alongside it.
describe("postSessionCreatedToHost", () => {
  test("still posts the session-created message unaffected by the analytics addition", () => {
    const sent: Array<{ message: unknown; targetOrigin: string }> = [];
    const parent = { postMessage: (message: unknown, targetOrigin: string) => sent.push({ message, targetOrigin }) };
    const ok = postSessionCreatedToHost("sid-123", { embedded: true, parent, self: {}, origin: "https://host.example" });
    expect(ok).toBe(true);
    expect(sent).toEqual([{ message: sessionCreatedMessage("sid-123"), targetOrigin: "https://host.example" }]);
  });
});

describe("resolveHostOrigin / originOf", () => {
  test("explicit embedOrigin wins over referrer", () => {
    expect(
      resolveHostOrigin({
        search: "?embedOrigin=https://explicit.example",
        referrer: "https://referrer.example/page",
        selfOrigin: "https://lfg.example",
      }),
    ).toBe("https://explicit.example");
  });

  test("falls back to a cross-origin referrer", () => {
    expect(
      resolveHostOrigin({ search: "", referrer: "https://referrer.example/page", selfOrigin: "https://lfg.example" }),
    ).toBe("https://referrer.example");
  });

  test("ignores a same-origin referrer (our own navigation, not the host)", () => {
    expect(
      resolveHostOrigin({ search: "", referrer: "https://lfg.example/prev", selfOrigin: "https://lfg.example" }),
    ).toBe(null);
  });

  test("falls back to the cached origin when neither param nor referrer resolves", () => {
    expect(resolveHostOrigin({ search: "", referrer: null, selfOrigin: "https://lfg.example", cached: "https://cached.example" })).toBe(
      "https://cached.example",
    );
  });

  test("originOf rejects non-http(s) and malformed input", () => {
    expect(originOf(null)).toBe(null);
    expect(originOf("not a url")).toBe(null);
    expect(originOf("javascript:alert(1)")).toBe(null);
    expect(originOf("https://a.example/path?x=1")).toBe("https://a.example");
  });
});
