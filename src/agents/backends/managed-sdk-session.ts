// Shared lifecycle for process-supervised SDK, RPC, and structured-protocol
// coding agents. Provider adapters own their native client. This module owns
// the LFG control plane: registry state, command-file delivery, transcript
// indexing, queue order, prompts, interruption, and shutdown.
import {
  type AisdkCommand,
  type AisdkPrompt,
  cmdPath,
  currentBootId,
  patchEntry,
  removeEntry,
  writeEntry,
} from "../../aisdk-registry.ts";
import { sessionTitleFromPrompt } from "../../omg-capabilities.ts";
import type { SessionMsg } from "../../sessions.ts";
import { indexSessionMessagesDirect } from "../../transcript-index.ts";
import { managedSdkStartupCmdOffset, readNewCmdLines, writeCursor } from "./cmd-tail.ts";
import { makeDraftPublisher } from "./draft.ts";

export type ManagedSdkAgent = "grok" | "cursor" | "fx" | "copilot" | "jcode";

export type ManagedSdkPromptOption = {
  label: string;
  description?: string;
  value?: unknown;
};

export type ManagedSdkEventSink = {
  draft(text: string): void;
  thinking(text: string): void;
  /**
   * Commit streamed assistant text into the transcript before a tool call (or
   * any other mid-turn boundary). ACP agents narrate between tools; without a
   * commit those segments stay in one draft and glue into a single wall of text
   * at turn end (e.g. "codebase.This is the vibes repo").
   */
  commitText(text: string): void;
  toolStart(id: string, name: string, input?: unknown): void;
  toolEnd(id: string, name: string, output?: unknown, error?: boolean): void;
  ask(question: string, options: ManagedSdkPromptOption[], header?: string): Promise<number | null>;
};

export type ManagedSdkRuntime = {
  nativeSessionId: string;
  runTurn(prompt: string, sink: ManagedSdkEventSink): Promise<{ text?: string; thinking?: string }>;
  interrupt(): Promise<void> | void;
  close(): Promise<void> | void;
  setModel?(model: string): Promise<void> | void;
  setThinkingLevel?(thinkingLevel: string): Promise<void> | void;
};

export type ManagedSdkSessionOptions = {
  key: string;
  agent: ManagedSdkAgent;
  cwd: string;
  model: string;
  managedName: string;
  initialPrompt?: string;
  resume?: string;
  thinkingLevel?: string;
  recoveredAt?: number | null;
  createRuntime(sink: ManagedSdkEventSink): Promise<ManagedSdkRuntime>;
  /** Defaults to process.exit. Tests replace this so shutdown can return. */
  exitProcess?: (code: number) => void;
};

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function clipped(value: unknown, max = 8_000): string {
  const raw = text(value);
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}\n… [truncated]`;
}

function row(role: string, kind: SessionMsg["kind"], body: string, id: string = crypto.randomUUID()): SessionMsg {
  return { id, role, kind, text: body, ts: Date.now() };
}

export async function runManagedSdkSession(options: ManagedSdkSessionOptions): Promise<void> {
  const {
    key,
    agent,
    cwd,
    managedName,
    initialPrompt = "",
    recoveredAt = null,
    exitProcess = (code) => process.exit(code),
  } = options;
  let model = options.model;
  let thinkingLevel = options.thinkingLevel;
  let closing = false;
  let draining = false;
  let runtime: ManagedSdkRuntime | null = null;
  let draft = "";
  let thought = "";
  const queue: string[] = [];
  const publishDraft = makeDraftPublisher(key);
  const emittedTools = new Set<string>();
  let promptResolver: ((index: number | null) => void) | null = null;
  const commandFile = cmdPath(key);
  let commandOffset = managedSdkStartupCmdOffset(commandFile, recoveredAt);
  writeCursor(commandFile, commandOffset);
  const bootId = currentBootId();
  writeEntry({
    sessionId: key,
    agent,
    threadId: options.resume ?? null,
    harnessPid: process.pid,
    tmuxName: managedName,
    supervisor: "process",
    bootId,
    recoveryClaimBootId: recoveredAt ? bootId : null,
    recoveredAt,
    thinkingLevel: thinkingLevel ?? null,
    cwd,
    model,
    busy: false,
    prompt: null,
    title: sessionTitleFromPrompt(initialPrompt),
    createdAt: Date.now(),
  });

  try {
    process.chdir(cwd);
  } catch {}

  const sink: ManagedSdkEventSink = {
    draft(next) {
      draft = next;
      publishDraft(next);
    },
    thinking(next) {
      thought = next;
      if (!draft) publishDraft(next);
    },
    commitText(next) {
      const body = next.trim();
      draft = "";
      publishDraft("", true);
      if (!body) return;
      indexSessionMessagesDirect(key, [row("assistant", "text", body)]);
    },
    toolStart(id, name, input) {
      const toolId = `${id}:start`;
      if (emittedTools.has(toolId)) return;
      emittedTools.add(toolId);
      const detail = clipped(input);
      indexSessionMessagesDirect(key, [
        row("assistant", "tool_use", detail ? `${name}: ${detail}` : name, toolId),
      ]);
    },
    toolEnd(id, name, output, error = false) {
      const toolId = `${id}:end`;
      if (emittedTools.has(toolId)) return;
      emittedTools.add(toolId);
      const detail = clipped(output);
      if (!detail) return;
      indexSessionMessagesDirect(key, [
        row(error ? "assistant" : "user", "tool_result", `${name}: ${detail}`, toolId),
      ]);
    },
    ask(question, options, header) {
      if (!options.length) return Promise.resolve(null);
      if (promptResolver) promptResolver(null);
      const prompt: AisdkPrompt = {
        question,
        header,
        options: options.map((option, index) => ({
          index,
          label: option.label,
          description: option.description,
          selected: index === 0,
        })),
      };
      patchEntry(key, { busy: false, prompt, draftText: null, draftUpdatedAt: null });
      publishDraft("", true);
      return new Promise<number | null>((resolve) => {
        promptResolver = resolve;
      });
    },
  };

  try {
    runtime = await options.createRuntime(sink);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    indexSessionMessagesDirect(key, [
      { ...row("assistant", "text", `${agent} SDK failed to start: ${message}`), apiError: true },
    ]);
    throw error;
  }

  if (runtime.nativeSessionId) {
    patchEntry(key, { threadId: runtime.nativeSessionId });
  }
  // Advertise the signal only after the provider runtime is ready and the
  // handler is installed. A mixed-version serve process then safely falls back
  // to polling for older harnesses instead of signaling a process that would
  // treat SIGUSR1 as fatal.
  process.on("SIGUSR1", consumeCommands);
  patchEntry(key, { commandWakeSignal: "SIGUSR1" });

  async function runTurn(prompt: string): Promise<void> {
    if (!runtime) return;
    indexSessionMessagesDirect(key, [row("user", "text", prompt)]);
    draft = "";
    thought = "";
    publishDraft("", true);
    try {
      const result = await runtime.runTurn(prompt, sink);
      const rows: SessionMsg[] = [];
      const finalThought = result.thinking?.trim() || thought.trim();
      const finalText = result.text?.trim() || draft.trim();
      if (finalThought) rows.push(row("assistant", "thinking", clipped(finalThought)));
      if (finalText) rows.push(row("assistant", "text", finalText));
      if (rows.length) indexSessionMessagesDirect(key, rows);
    } catch (error) {
      if (closing) return;
      const message = error instanceof Error ? error.message : String(error);
      indexSessionMessagesDirect(key, [
        { ...row("assistant", "text", `${agent} turn failed: ${message.slice(0, 800)}`), apiError: true },
      ]);
    } finally {
      draft = "";
      thought = "";
      publishDraft("", true);
    }
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (queue.length && !closing) {
        const prompt = queue.shift()!;
        patchEntry(key, { busy: true, prompt: null, draftText: null, draftUpdatedAt: null });
        try {
          await runTurn(prompt);
        } finally {
          if (!closing) patchEntry(key, { busy: false, prompt: null, draftText: null, draftUpdatedAt: null });
        }
      }
    } finally {
      draining = false;
    }
  }

  async function shutdown(): Promise<void> {
    if (closing) return;
    closing = true;
    process.off("SIGUSR1", consumeCommands);
    promptResolver?.(null);
    promptResolver = null;
    removeEntry(key);
    try {
      await runtime?.close();
    } finally {
      exitProcess(0);
    }
  }

  function dispatch(command: AisdkCommand): void {
    if (command.type === "send") {
      if (command.text.trim()) {
        queue.push(command.text);
        void drain();
      }
      return;
    }
    if (command.type === "interrupt") {
      promptResolver?.(null);
      promptResolver = null;
      void runtime?.interrupt();
      return;
    }
    if (command.type === "answer") {
      const resolve = promptResolver;
      promptResolver = null;
      patchEntry(key, { prompt: null, busy: true });
      resolve?.(command.index);
      return;
    }
    if (command.type === "dismiss") {
      const resolve = promptResolver;
      promptResolver = null;
      patchEntry(key, { prompt: null, busy: true });
      resolve?.(null);
      return;
    }
    if (command.type === "set_model" && runtime?.setModel) {
      void Promise.resolve(runtime.setModel(command.model)).then(() => {
        model = command.model;
        patchEntry(key, { model });
      }).catch((error) => console.error(`${agent} model change failed: ${error}`));
      return;
    }
    if (command.type === "set_thinking_level" && runtime?.setThinkingLevel) {
      void Promise.resolve(runtime.setThinkingLevel(command.thinkingLevel)).then(() => {
        thinkingLevel = command.thinkingLevel;
        patchEntry(key, { thinkingLevel });
      }).catch((error) => console.error(`${agent} thinking change failed: ${error}`));
      return;
    }
    if (command.type === "close") void shutdown();
  }

  function consumeCommands(): void {
    const { lines, offset } = readNewCmdLines(commandFile, commandOffset);
    if (offset === commandOffset && !lines.length) return;
    commandOffset = offset;
    for (const line of lines) {
      try {
        dispatch(JSON.parse(line) as AisdkCommand);
      } catch {}
    }
    if (!closing) writeCursor(commandFile, commandOffset);
  }

  const poll = setInterval(consumeCommands, 250);
  consumeCommands();

  if (initialPrompt) {
    queue.push(initialPrompt);
    void drain();
  }

  await new Promise<void>((resolve) => {
    const exitWatch = setInterval(() => {
      if (!closing) return;
      clearInterval(poll);
      clearInterval(exitWatch);
      resolve();
    }, 100);
  });
}
