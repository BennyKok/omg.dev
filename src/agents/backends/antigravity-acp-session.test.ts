import { describe, expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { resolveAcpConfigChoice } from "./acp-session.ts";
import {
  ANTIGRAVITY_SIGN_IN_HINT,
  antigravityHarnessArgv,
  antigravityThinkingValue,
  antigravityVerificationNotice,
  isAcpAuthRequired,
} from "./antigravity-acp-session.ts";
import { ANTIGRAVITY_VERIFICATION_REPLY, antigravityVerifyUrlFromLog } from "./antigravity-verify.ts";

// The shape `agy acp` documents: a Model picker with the plan's models and a
// Thinking level picker with Low, Medium, High, Extra, Max.
const OPTIONS: acp.SessionConfigOption[] = [
  {
    type: "select",
    id: "model",
    name: "Model",
    category: "model",
    currentValue: "gemini-3.1-pro",
    options: [
      { value: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
      { value: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
      { value: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite" },
    ],
  },
  {
    type: "select",
    id: "thinking",
    name: "Thinking level",
    category: "thought_level",
    currentValue: "medium",
    options: [
      {
        group: "levels",
        name: "Levels",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
          { value: "extra", name: "Extra" },
          { value: "max", name: "Max" },
        ],
      },
    ],
  },
];

describe("Antigravity ACP launch", () => {
  test("runs the official ACP server with per-session workers so HTTP MCP is advertised", () => {
    expect(antigravityHarnessArgv()).toEqual(["acp", "--process-per-session"]);
    // Permission prompts must reach the person: never auto-approve.
    expect(antigravityHarnessArgv()).not.toContain("--dangerously-skip-permissions");
  });

  test("maps omg.dev's xhigh to Antigravity's Extra level", () => {
    expect(antigravityThinkingValue("xhigh")).toBe("extra");
    expect(antigravityThinkingValue("max")).toBe("max");
  });

  test("recognises the documented Authentication required error", () => {
    expect(isAcpAuthRequired({ code: -32000, message: "Authentication required" })).toBe(true);
    expect(isAcpAuthRequired(new Error("Authentication required"))).toBe(true);
    expect(isAcpAuthRequired(new Error("socket closed"))).toBe(false);
    expect(ANTIGRAVITY_SIGN_IN_HINT).toContain("agy acp --login");
  });
});

describe("ACP session option matching", () => {
  test("matches a value id, a display name, or a unique fragment", () => {
    expect(resolveAcpConfigChoice(OPTIONS, "model", "gemini-3.5-flash")).toEqual({ configId: "model", value: "gemini-3.5-flash" });
    expect(resolveAcpConfigChoice(OPTIONS, "model", "Gemini 3.1 Pro")).toEqual({ configId: "model", value: "gemini-3.1-pro" });
    expect(resolveAcpConfigChoice(OPTIONS, "model", "lite")).toEqual({ configId: "model", value: "gemini-3.5-flash-lite" });
  });

  test("reads grouped options", () => {
    expect(resolveAcpConfigChoice(OPTIONS, "thought_level", "extra")).toEqual({ configId: "thinking", value: "extra" });
    expect(resolveAcpConfigChoice(OPTIONS, "thought_level", "HIGH")).toEqual({ configId: "thinking", value: "high" });
  });

  test("refuses to guess between two candidates or an unknown value", () => {
    expect(resolveAcpConfigChoice(OPTIONS, "model", "flash")).toBeNull();
    expect(resolveAcpConfigChoice(OPTIONS, "model", "claude-opus")).toBeNull();
    expect(resolveAcpConfigChoice(OPTIONS, "mode", "auto")).toBeNull();
    expect(resolveAcpConfigChoice([], "model", "gemini")).toBeNull();
  });
});

describe("Antigravity account verification", () => {
  // Trimmed from a real agy 1.5.9 log: Google answers 403 VALIDATION_REQUIRED
  // while `agy models` still exits 0.
  const LOG = `I1115 05:14:34.839236 http_helpers.go:876] Failed to make code assist backend request: {
  "error": {
    "code": 403,
    "message": "Verify your account to continue.",
    "status": "PERMISSION_DENIED",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "VALIDATION_REQUIRED",
        "metadata": {
          "validation_url": "https://accounts.google.com/v3/signin/continue?plt=TOKEN&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini&sarp=1",
          "validation_learn_more_url": "https://support.google.com/accounts?p=al_alert"
        }
      }
    ]
  }
}`;

  test("reads Google's verification link from the agy log", () => {
    expect(antigravityVerifyUrlFromLog(LOG)).toBe(
      "https://accounts.google.com/v3/signin/continue?plt=TOKEN&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini&sarp=1",
    );
  });

  test("ignores a healthy log and any link off accounts.google.com", () => {
    expect(antigravityVerifyUrlFromLog("I1115 models listed")).toBeNull();
    expect(antigravityVerifyUrlFromLog('VALIDATION_REQUIRED "validation_url": "https://evil.example/x"')).toBeNull();
    expect(antigravityVerifyUrlFromLog('VALIDATION_REQUIRED "validation_url": "http://accounts.google.com/x"')).toBeNull();
  });

  test("recognises agy's bare verification reply and explains the fix", () => {
    expect(ANTIGRAVITY_VERIFICATION_REPLY.test("\n⚠ Verification Required\n")).toBe(true);
    expect(ANTIGRAVITY_VERIFICATION_REPLY.test("Verification Required for the build step is done.")).toBe(false);
    expect(antigravityVerificationNotice("https://accounts.google.com/x")).toContain("https://accounts.google.com/x");
    expect(antigravityVerificationNotice(null)).toContain("Verify account");
  });
});
