/**
 * The box-side connect flow: which routes are hit, with what, and which
 * clipboard contents count as a Claude code.
 */
import { expect, test } from "bun:test";
import {
  cancelAgentAuth,
  connectProviderFor,
  looksLikeClaudeCode,
  pollAgentAuth,
  removeClaudeAccount,
  startAgentAuth,
  submitAgentAuthCode,
  type AgentAuthTransport,
} from "../src/omg/agent-auth";

function recorder() {
  const calls: { path: string; init?: RequestInit }[] = [];
  const transport: AgentAuthTransport = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      return { id: "s1", status: "waiting", needsCode: true, accounts: [] } as unknown as T;
    },
  };
  return { calls, transport };
}

test("start posts to the box auth route for the roster key", async () => {
  const { calls, transport } = recorder();
  await startAgentAuth(transport, "aisdk");
  expect(calls[0]?.path).toBe("/api/coding-agents/aisdk/auth");
  expect(calls[0]?.init?.method).toBe("POST");
  expect(calls[0]?.init?.body).toBe("{}");
});

test("reconnecting a specific Claude account names it", async () => {
  const { calls, transport } = recorder();
  await startAgentAuth(transport, "claude", { claudeAccountId: "acc-2" });
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ claudeAccountId: "acc-2" });
});

test("poll, code and cancel address the session id", async () => {
  const { calls, transport } = recorder();
  await pollAgentAuth(transport, "s1");
  await submitAgentAuthCode(transport, "s1", "  abc#xyz \n");
  await cancelAgentAuth(transport, "s1");
  expect(calls.map((c) => c.path)).toEqual([
    "/api/coding-agents/auth/s1",
    "/api/coding-agents/auth/s1/code",
    "/api/coding-agents/auth/s1",
  ]);
  expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ code: "abc#xyz" });
  expect(calls[2]?.init?.method).toBe("DELETE");
});

test("cancel swallows a box that already forgot the session", async () => {
  const transport: AgentAuthTransport = {
    async request(): Promise<never> {
      throw new Error("Login session not found");
    },
  };
  await expect(cancelAgentAuth(transport, "gone")).resolves.toBeUndefined();
});

test("disconnect deletes the Claude account on the box", async () => {
  const { calls, transport } = recorder();
  await removeClaudeAccount(transport, "acc-1");
  expect(calls[0]?.path).toBe("/api/coding-agents/claude/accounts/acc-1");
  expect(calls[0]?.init?.method).toBe("DELETE");
});

test("both roster spellings map to one provider", () => {
  expect(connectProviderFor("aisdk")).toBe("claude");
  expect(connectProviderFor("claude")).toBe("claude");
  expect(connectProviderFor("codex-aisdk")).toBe("codex");
  expect(connectProviderFor("opencode")).toBeNull();
  expect(connectProviderFor(null)).toBeNull();
});

test("only Claude-shaped clipboard text is auto-filled", () => {
  const code = "ac_" + "k".repeat(40);
  expect(looksLikeClaudeCode(`${code}#${"v".repeat(43)}`)).toBe(true);
  expect(looksLikeClaudeCode(code)).toBe(true);
  expect(looksLikeClaudeCode(`https://console.anthropic.com/oauth/code/callback?code=${code}&state=x`)).toBe(true);
  expect(looksLikeClaudeCode("hello")).toBe(false);
  expect(looksLikeClaudeCode("a sentence someone copied earlier")).toBe(false);
  expect(looksLikeClaudeCode("https://example.com/")).toBe(false);
  expect(looksLikeClaudeCode("")).toBe(false);
  expect(looksLikeClaudeCode(null)).toBe(false);
});
