import { describe, expect, test } from "bun:test";
import { parseFxAskResult } from "./fx-cli.ts";

// Captured from `fx ask --auto --json --no-save -- "say hi"` against fx 0.0.3.
const AUTH_FAILURE =
  '{"output":"AI_GATEWAY_API_KEY authentication failed · HTTP 401\\n","exit_code":1,' +
  '"model":"zai/glm-5.2","session_id":"","steps":0,"tool_calls":[],' +
  '"auth_failure":{"source":"AI_GATEWAY_API_KEY","reason":"http_unauthorized","http_status":401}}';

const SUCCESS =
  '{"output":"hi","exit_code":0,"model":"zai/glm-5.2","session_id":"s-1","steps":1,' +
  '"tool_calls":[{"name":"read_file","status":"completed"}]}';

describe("fx ask --json parsing", () => {
  test("takes the final result object, not the progress lines before it", () => {
    const stdout = ["thinking...", "reading files", SUCCESS, ""].join("\n");
    expect(parseFxAskResult(stdout)?.output).toBe("hi");
  });

  test("reports no result when fx printed nothing parseable", () => {
    expect(parseFxAskResult("")).toBeNull();
    expect(parseFxAskResult("boom\nnot json\n")).toBeNull();
  });

  test("ignores a JSON line that is not the ask result", () => {
    const stdout = ['{"kind":"models","count":228}', SUCCESS].join("\n");
    expect(parseFxAskResult(stdout)?.session_id).toBe("s-1");
  });

  /**
   * The failure this guards: a failed run is still a well-formed result object,
   * and fx puts the diagnostic in `output`. Reading `output` without checking
   * `exit_code` files "authentication failed" as the agent's answer, so a
   * scheduled run reports a finding that is really a broken credential.
   */
  test("a failed run carries its diagnostic in output with a non-zero exit_code", () => {
    const parsed = parseFxAskResult(AUTH_FAILURE);
    expect(parsed).not.toBeNull();
    expect(parsed!.exit_code).toBe(1);
    expect(parsed!.output).toContain("authentication failed");
  });
});
