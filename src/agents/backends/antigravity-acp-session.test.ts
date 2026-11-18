import { describe, expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { acpConfigChoices, resolveAcpConfigChoice } from "./acp-session.ts";
import {
  ANTIGRAVITY_SIGN_IN_HINT,
  antigravityAutoAllowOption,
  antigravityClampedLevel,
  antigravityHarnessArgv,
  antigravityOfferedLevels,
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
  test("runs the official ACP server with per-session workers and auto-approved tools", () => {
    expect(antigravityHarnessArgv()).toEqual(["acp", "--process-per-session", "--dangerously-skip-permissions"]);
  });

  test("accepts a permission request that agy still raises", () => {
    const allowOnce = { optionId: "once", kind: "allow_once" };
    const allowAlways = { optionId: "always", kind: "allow_always" };
    const reject = { optionId: "no", kind: "reject_once" };
    expect(antigravityAutoAllowOption([reject, allowOnce, allowAlways])).toBe("always");
    expect(antigravityAutoAllowOption([reject, allowOnce])).toBe("once");
    // No allow option at all: the person decides.
    expect(antigravityAutoAllowOption([reject])).toBeNull();
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

// This plan's picker offers Low, Medium and High only: no Extra, no Max.
const HIGH_ONLY_OPTIONS: acp.SessionConfigOption[] = [
  {
    type: "select",
    id: "thinking",
    name: "Thinking level",
    category: "thought_level",
    currentValue: "high",
    options: [
      {
        group: "levels",
        name: "Levels",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
        ],
      },
    ],
  },
];

describe("Antigravity thinking level clamp", () => {

  test("keeps a level the plan offers", () => {
    expect(antigravityClampedLevel(HIGH_ONLY_OPTIONS, "high")).toEqual({ configId: "thinking", value: "high", name: "High" });
    expect(antigravityClampedLevel(HIGH_ONLY_OPTIONS, "low")).toEqual({ configId: "thinking", value: "low", name: "Low" });
  });

  test("clamps an ask above the plan's ceiling to its highest level", () => {
    // A stored xhigh (Extra) or max must not be dropped, or the session
    // silently runs on the account default.
    expect(antigravityClampedLevel(HIGH_ONLY_OPTIONS, "xhigh")).toEqual({ configId: "thinking", value: "high", name: "High" });
    expect(antigravityClampedLevel(HIGH_ONLY_OPTIONS, "max")).toEqual({ configId: "thinking", value: "high", name: "High" });
  });

  test("stops at Extra when Max is wanted but the plan tops out there", () => {
    const EXTRA: acp.SessionConfigOption[] = [
      {
        type: "select",
        id: "thinking",
        name: "Thinking level",
        category: "thought_level",
        currentValue: "extra",
        options: [
          {
            group: "levels",
            name: "Levels",
            options: [
              { value: "low", name: "Low" },
              { value: "medium", name: "Medium" },
              { value: "high", name: "High" },
              { value: "extra", name: "Extra" },
            ],
          },
        ],
      },
    ];
    expect(antigravityClampedLevel(EXTRA, "max")).toEqual({ configId: "thinking", value: "extra", name: "Extra" });
    expect(antigravityClampedLevel(EXTRA, "xhigh")).toEqual({ configId: "thinking", value: "extra", name: "Extra" });
  });

  test("keeps the account default when the option is missing or unrankable", () => {
    expect(antigravityClampedLevel(OPTIONS, "medium")).toEqual({ configId: "thinking", value: "medium", name: "Medium" });
    expect(antigravityClampedLevel([], "xhigh")).toBeNull();
    expect(antigravityClampedLevel(HIGH_ONLY_OPTIONS, "off")).toBeNull();
  });

  test("acpConfigChoices exposes the offered values for the clamp", () => {
    const offered = acpConfigChoices(OPTIONS, "thought_level");
    expect(offered?.configId).toBe("thinking");
    expect(offered?.choices.map((choice) => choice.value)).toEqual(["low", "medium", "high", "extra", "max"]);
    expect(acpConfigChoices(OPTIONS, "mode")).toBeNull();
  });
});

describe("Antigravity offered levels", () => {
  test("maps what agy offered onto omg.dev's vocabulary, in canonical order", () => {
    expect(antigravityOfferedLevels(OPTIONS)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(antigravityOfferedLevels(HIGH_ONLY_OPTIONS)).toEqual(["low", "medium", "high"]);
  });

  test("dedupes Extra and xhigh, and ignores a value the vocabulary cannot rank", () => {
    const MIXED: acp.SessionConfigOption[] = [
      {
        type: "select",
        id: "thinking",
        name: "Thinking level",
        category: "thought_level",
        currentValue: "extra",
        options: [
          {
            group: "levels",
            name: "Levels",
            options: [
              { value: "extra", name: "Extra" },
              { value: "xhigh", name: "XHigh" },
              { value: "ultra", name: "Ultra" },
            ],
          },
        ],
      },
    ];
    expect(antigravityOfferedLevels(MIXED)).toEqual(["xhigh"]);
  });

  test("an account that offered no Thinking option records none", () => {
    expect(antigravityOfferedLevels([])).toEqual([]);
    expect(antigravityOfferedLevels([OPTIONS[0]!])).toEqual([]);
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
