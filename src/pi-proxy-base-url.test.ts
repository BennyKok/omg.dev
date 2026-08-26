import { expect, test } from "bun:test";
import { resolvePiProxyBaseUrl } from "./agents/backends/pi-session.ts";

// pi's models.json wants the bare proxy base. Infra injects OMG_AI_URL bare and
// ANTHROPIC_BASE_URL with the SDK's `/v1` suffix, so both normalise to the same
// value and pi routes identically whichever one the platform supplies.
test("derives the proxy base from OMG_AI_URL", () => {
  expect(resolvePiProxyBaseUrl({ OMG_AI_URL: "http://169.254.0.1:9090" })).toBe(
    "http://169.254.0.1:9090",
  );
});

test("strips a trailing slash from OMG_AI_URL", () => {
  expect(resolvePiProxyBaseUrl({ OMG_AI_URL: "http://169.254.0.1:9090/" })).toBe(
    "http://169.254.0.1:9090",
  );
});

test("still accepts ANTHROPIC_BASE_URL, suffix and all", () => {
  expect(resolvePiProxyBaseUrl({ ANTHROPIC_BASE_URL: "http://169.254.0.1:9090/v1" })).toBe(
    "http://169.254.0.1:9090",
  );
});

test("an explicit ANTHROPIC_BASE_URL outranks OMG_AI_URL", () => {
  expect(
    resolvePiProxyBaseUrl({
      ANTHROPIC_BASE_URL: "https://gateway.example/v1",
      OMG_AI_URL: "http://169.254.0.1:9090",
    }),
  ).toBe("https://gateway.example");
});

// The sudo forwarding in the infra agent template passes VAR="${VAR:-}", so an
// unset variable arrives as an empty string rather than absent. That must read
// as "not configured" and fall through, not as a base URL of "".
test("an empty ANTHROPIC_BASE_URL falls through to OMG_AI_URL", () => {
  expect(
    resolvePiProxyBaseUrl({ ANTHROPIC_BASE_URL: "  ", OMG_AI_URL: "http://169.254.0.1:9090" }),
  ).toBe("http://169.254.0.1:9090");
});

test("no managed variable means pi keeps its own configured credentials", () => {
  expect(resolvePiProxyBaseUrl({})).toBeUndefined();
  expect(resolvePiProxyBaseUrl({ ANTHROPIC_BASE_URL: "", OMG_AI_URL: "" })).toBeUndefined();
});
