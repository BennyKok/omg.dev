// Shared ACP session-open and session-update handling for Grok and Cursor.
// Recovery must honor initialize capabilities: session/load is optional and
// replays the whole conversation as notifications. session/resume continues
// without that replay. Never call a method the agent did not advertise.
import * as acp from "@agentclientprotocol/sdk";
import type { ManagedSdkEventSink } from "./managed-sdk-session.ts";

export function contentText(content: acp.ContentBlock): string {
  return content.type === "text" ? content.text : "";
}

export type AcpAdvertisedSessionMethods = {
  loadSession: boolean;
  resume: boolean;
  close: boolean;
};

export type AcpResumeStrategy = "resume" | "load" | "new";

export type AcpUpdateState = {
  draft: string;
  thought: string;
  replaying: boolean;
};

export function advertisedAcpSessionMethods(
  init: { agentCapabilities?: acp.AgentCapabilities | null },
): AcpAdvertisedSessionMethods {
  const caps = init.agentCapabilities;
  return {
    loadSession: caps?.loadSession === true,
    resume: caps?.sessionCapabilities?.resume != null,
    close: caps?.sessionCapabilities?.close != null,
  };
}

export function acpResumeStrategy(
  methods: AcpAdvertisedSessionMethods,
  resumeId?: string,
): AcpResumeStrategy {
  if (!resumeId) return "new";
  if (methods.resume) return "resume";
  if (methods.loadSession) return "load";
  return "new";
}

function flushAcpDraft(sink: ManagedSdkEventSink, state: AcpUpdateState): void {
  const body = state.draft;
  if (!body.trim()) return;
  // Clear ACP state first so a later session.prompt return cannot re-emit the
  // same narration as one concatenated turn-end blob.
  state.draft = "";
  sink.commitText(body);
  sink.draft("");
}

export function applyAcpSessionUpdate(
  update: acp.SessionUpdate,
  sink: ManagedSdkEventSink,
  state: AcpUpdateState,
): void {
  // session/load streams history via the same notifications as a live turn.
  // Replaying them would duplicate tool rows and leave a stale draft.
  if (state.replaying) return;
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      state.draft += contentText(update.content);
      sink.draft(state.draft);
      break;
    case "agent_thought_chunk":
      state.thought += contentText(update.content);
      sink.thinking(state.thought);
      break;
    case "tool_call":
      // Cursor (and other ACP agents) stream short narrations between tools.
      // Commit each segment before the tool so the transcript keeps message
      // boundaries instead of one glued wall of text at turn end.
      flushAcpDraft(sink, state);
      sink.toolStart(update.toolCallId, update.name ?? update.title, update.rawInput);
      if (update.status === "completed" || update.status === "failed") {
        sink.toolEnd(update.toolCallId, update.name ?? update.title, update.rawOutput, update.status === "failed");
      }
      break;
    case "tool_call_update":
      if (update.status === "completed" || update.status === "failed") {
        sink.toolEnd(update.toolCallId, update.title ?? "tool", update.rawOutput, update.status === "failed");
      }
      break;
    default:
      break;
  }
}

export type AcpAgentRpc = {
  request: (method: string, params: unknown) => Promise<unknown>;
};

export async function bindAcpConversation(opts: {
  context: AcpAgentRpc;
  cwd: string;
  mcpServers: acp.McpServer[];
  resume?: string;
  state: AcpUpdateState;
  sink: ManagedSdkEventSink;
}): Promise<{
  sessionId: string;
  methods: AcpAdvertisedSessionMethods;
  /** Session options the agent reported on open (model, thinking level, ...). */
  configOptions: acp.SessionConfigOption[];
}> {
  const init = await opts.context.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  }) as { agentCapabilities?: acp.AgentCapabilities | null };
  const methods = advertisedAcpSessionMethods(init);
  const strategy = acpResumeStrategy(methods, opts.resume);
  if (strategy === "resume") {
    const resumed = await opts.context.request(acp.methods.agent.session.resume, {
      sessionId: opts.resume,
      cwd: opts.cwd,
      mcpServers: opts.mcpServers,
    }) as { configOptions?: acp.SessionConfigOption[] | null } | null;
    return { sessionId: opts.resume!, methods, configOptions: resumed?.configOptions ?? [] };
  }
  if (strategy === "load") {
    opts.state.replaying = true;
    let loadedOptions: acp.SessionConfigOption[] = [];
    try {
      const loaded = await opts.context.request(acp.methods.agent.session.load, {
        sessionId: opts.resume,
        cwd: opts.cwd,
        mcpServers: opts.mcpServers,
      }) as { configOptions?: acp.SessionConfigOption[] | null } | null;
      loadedOptions = loaded?.configOptions ?? [];
    } finally {
      opts.state.replaying = false;
      opts.state.draft = "";
      opts.state.thought = "";
      opts.sink.draft("");
    }
    return { sessionId: opts.resume!, methods, configOptions: loadedOptions };
  }
  const created = await opts.context.request(acp.methods.agent.session.new, {
    cwd: opts.cwd,
    mcpServers: opts.mcpServers,
  }) as { sessionId?: string; configOptions?: acp.SessionConfigOption[] | null };
  const sessionId = created.sessionId;
  if (!sessionId) throw new Error("ACP session/new returned no session id");
  return { sessionId, methods, configOptions: created.configOptions ?? [] };
}

function flatSelectOptions(option: acp.SessionConfigOption): acp.SessionConfigSelectOption[] {
  if (option.type !== "select") return [];
  return option.options.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

/**
 * Resolve a requested value against an agent-advertised select option.
 *
 * ACP agents publish their own value ids (an opaque model id, "extra" for a
 * thinking level), while omg.dev stores the user's words. Match the value id
 * first, then the display name, both case-insensitively, then a unique
 * substring of either. Return null rather than guess between two candidates.
 * Pure, so the matching rule is testable without an agent process.
 */
export function resolveAcpConfigChoice(
  options: readonly acp.SessionConfigOption[],
  category: string,
  wanted: string,
): { configId: string; value: string } | null {
  const option = options.find((entry) => entry.type === "select" && entry.category === category);
  if (!option) return null;
  const choices = flatSelectOptions(option);
  const needle = wanted.trim().toLowerCase();
  if (!needle) return null;
  const exact = choices.find((choice) => choice.value.toLowerCase() === needle)
    ?? choices.find((choice) => choice.name.toLowerCase() === needle);
  if (exact) return { configId: option.id, value: exact.value };
  const partial = choices.filter((choice) =>
    choice.value.toLowerCase().includes(needle) || choice.name.toLowerCase().includes(needle));
  return partial.length === 1 ? { configId: option.id, value: partial[0]!.value } : null;
}
