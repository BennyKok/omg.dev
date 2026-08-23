import { describe, expect, test } from "bun:test";
import { voiceErrorMessage } from "./voice-errors";

describe("voiceErrorMessage", () => {
  test("turns the OpenAI errors seen in production into actionable text", () => {
    expect(voiceErrorMessage({ code: "invalid_api_key", provider: "openai" }, 502)).toBe(
      "OpenAI rejected the API key. Replace it in Voice settings.",
    );
    expect(
      voiceErrorMessage({ code: "credit_balance_exhausted", provider: "openai" }, 502),
    ).toBe("OpenAI API credit is empty. Add credit in the provider billing settings.");
  });

  test("separates retryable failures from missing configuration", () => {
    expect(voiceErrorMessage({ code: "rate_limited", provider: "openai" }, 502)).toContain(
      "Wait and try again",
    );
    expect(voiceErrorMessage({ code: "provider_not_configured", provider: "elevenlabs" }, 503)).toBe(
      "ElevenLabs is not configured. Add an API key in Voice settings.",
    );
  });

  test("does not render an unknown server error body", () => {
    const message = voiceErrorMessage(
      { code: "unknown-provider-code", error: "secret upstream response" },
      500,
    );
    expect(message).toBe("Speech transcription failed. Try again.");
    expect(message).not.toContain("secret upstream response");
  });

  test("keeps a useful fallback for older servers", () => {
    expect(voiceErrorMessage({}, 429)).toContain("API credit");
    expect(voiceErrorMessage({}, 401)).toContain("API key");
  });
});
