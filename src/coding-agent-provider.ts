import { defaultModelForAgent } from "./agent-catalog.ts";
import {
  CODING_AGENT_ADAPTERS,
  type ActiveSessionAgentKind,
  type CodingAgentCapabilities,
  type CodingAgentDriver,
  type CodingAgentProduct,
} from "./coding-agent-adapters.ts";
import {
  spawnManagedAisdkSession,
  spawnManagedCodexAisdkSession,
  spawnManagedCopilotSdkSession,
  spawnManagedCursorAcpSession,
  spawnManagedFxAcpSession,
  spawnManagedDeepseekAcpSession,
  spawnManagedGrokAcpSession,
  spawnManagedJcodeSdkSession,
  spawnManagedMuseMspSession,
  spawnManagedOpencodeAisdkSession,
  spawnManagedPiSession,
} from "./tmux.ts";
import type { CodexServiceTier } from "./service-tier.ts";

export type CodingAgentLaunchRequest = {
  agent: ActiveSessionAgentKind;
  name: string;
  cwd: string;
  prompt?: string;
  model?: string;
  thinkingLevel?: string;
  serviceTier?: CodexServiceTier;
  fastMode?: boolean;
  sessionId: string;
  omgUser?: string | null;
  containInAgentSlice?: boolean;
  claudeAccountId?: string;
  resume?: string;
};

export type CodingAgentLaunchResult = {
  ok: boolean;
  error?: string;
  nativeSessionId?: string;
};

/**
 * One active coding-agent provider contract.
 *
 * Product identity is stable. Driver identity is an implementation detail.
 * Every new-session launch crosses this interface, including terminal-backed
 * providers that do not offer an SDK yet.
 */
export type CodingAgentProvider = {
  kind: ActiveSessionAgentKind;
  product: CodingAgentProduct;
  driver: CodingAgentDriver;
  capabilities: CodingAgentCapabilities;
  launch(request: CodingAgentLaunchRequest): CodingAgentLaunchResult;
};

function provider(
  kind: ActiveSessionAgentKind,
  launch: CodingAgentProvider["launch"],
): CodingAgentProvider {
  const adapter = CODING_AGENT_ADAPTERS[kind];
  return {
    kind,
    product: adapter.product,
    driver: adapter.driver,
    capabilities: adapter.capabilities,
    launch,
  };
}

export const ACTIVE_CODING_AGENT_PROVIDERS = {
  aisdk: provider("aisdk", (request) =>
    spawnManagedAisdkSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model ?? "opus",
      sessionId: request.sessionId,
      thinkingLevel: request.thinkingLevel,
      fastMode: request.fastMode,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
      claudeAccountId: request.claudeAccountId,
    })),
  "codex-aisdk": provider("codex-aisdk", (request) =>
    spawnManagedCodexAisdkSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model ?? "gpt-5.5",
      key: request.sessionId,
      thinkingLevel: request.thinkingLevel,
      serviceTier: request.serviceTier,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
      resume: request.resume,
    })),
  opencode: provider("opencode", (request) => {
    if (!request.model) return { ok: false, error: "opencode model is required" };
    return spawnManagedOpencodeAisdkSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model,
      key: request.sessionId,
      thinkingLevel: request.thinkingLevel,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
      resume: request.resume,
    });
  }),
  jcode: provider("jcode", (request) =>
    spawnManagedJcodeSdkSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model ?? "auto",
      key: request.sessionId,
      thinkingLevel: request.thinkingLevel,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
      resume: request.resume,
    })),
  grok: provider("grok", (request) =>
    spawnManagedGrokAcpSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model ?? "grok-code-fast-1",
      key: request.sessionId,
      thinkingLevel: request.thinkingLevel,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
      resume: request.resume,
    })),
  cursor: provider("cursor", (request) =>
    spawnManagedCursorAcpSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model ?? "auto",
      key: request.sessionId,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
      resume: request.resume,
    })),
  fx: provider("fx", (request) =>
    spawnManagedFxAcpSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model ?? "auto",
      key: request.sessionId,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
      resume: request.resume,
    })),
  muse: provider("muse", (request) =>
    spawnManagedMuseMspSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model ?? defaultModelForAgent("muse"),
      key: request.sessionId,
      thinkingLevel: request.thinkingLevel,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
      resume: request.resume,
    })),
  deepseek: provider("deepseek", (request) =>
    spawnManagedDeepseekAcpSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model ?? "deepseek-v4-flash",
      key: request.sessionId,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
    })),
  pi: provider("pi", (request) =>
    spawnManagedPiSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model ?? "sonnet",
      key: request.sessionId,
      thinkingLevel: request.thinkingLevel,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
      resume: request.resume,
    })),
  copilot: provider("copilot", (request) =>
    spawnManagedCopilotSdkSession({
      name: request.name,
      cwd: request.cwd,
      prompt: request.prompt,
      model: request.model ?? "auto",
      key: request.sessionId,
      omgSessionId: request.sessionId,
      omgUser: request.omgUser,
      containInAgentSlice: request.containInAgentSlice,
      resume: request.resume,
    })),
} as const satisfies Record<ActiveSessionAgentKind, CodingAgentProvider>;

export function launchCodingAgentSession(
  request: CodingAgentLaunchRequest,
): CodingAgentLaunchResult {
  return ACTIVE_CODING_AGENT_PROVIDERS[request.agent].launch(request);
}
