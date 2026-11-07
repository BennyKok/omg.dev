import { expect, test } from "bun:test";
import { resolvePiProxyBaseUrl } from "./agents/backends/pi-session.ts";

// pi's models.json wants the bare proxy base. ANTHROPIC_BASE_URL carries the
// SDK's `/v1` suffix, which is stripped.
test("accepts ANTHROPIC_BASE_URL, suffix and all", () => {
  expect(resolvePiProxyBaseUrl({ ANTHROPIC_BASE_URL: "https://gateway.example/v1" })).toBe("https://gateway.example");
  expect(resolvePiProxyBaseUrl({ ANTHROPIC_BASE_URL: "https://gateway.example/" })).toBe("https://gateway.example");
});

// omg.dev is local software: the hosted sandbox's OMG_AI_URL proxy is gone, so
// it must not redirect pi away from the real Anthropic API.
test("ignores the retired hosted OMG_AI_URL proxy", () => {
  expect(resolvePiProxyBaseUrl({ OMG_AI_URL: "http://169.254.0.1:9090" })).toBeUndefined();
});

// An unset variable can arrive as an empty string. That reads as "not
// configured", not as a base URL of "".
test("an empty ANTHROPIC_BASE_URL is not configured", () => {
  expect(resolvePiProxyBaseUrl({ ANTHROPIC_BASE_URL: "  " })).toBeUndefined();
});
