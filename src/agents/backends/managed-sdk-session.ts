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

/**
 * The option a typed reply picks: an exact label, case-insensitive. Null when
 * the text is the user's own answer rather than one of the options.
 * @internal exported for tests
 */
export function optionIndexForText(prompt: AisdkPrompt | null, text: string): number | null {
  const typed = text.trim().toLowerCase();
  const match = prompt?.options.find((o) => o.label.trim().toLowerCase() === typed);
  return match ? match.index : null;
}

export type ManagedSdkAgent = "grok" | "cursor" | "fx" | "muse" | "deepseek" | "devin" | "antigravity" | "copilot" | "jcode";

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
  /** Runtime notice that must not replace or clear an in-flight answer draft. */
  notice?(text: string): void;
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
  /**
   * False once the agent process behind this runtime has ended. A runtime that
   * reports this is replaced before the next turn; see `liveRuntime`.
   */
  alive?(): boolean;
  /**
   * Return and clear the text the runtime streamed outside a turn. An agent
   * can continue on its own after a turn ended, for example when a background
   * command it started finishes. The session commits that text when the
   * activity goes quiet, so the runtime must not offer it again.
   */
  takeDraft?(): { text: string; thinking: string };
};

/**
 * What a replacement runtime must continue from. `createRuntime` gets it only
 * when it replaces a runtime whose agent process ended: `resume` is the native
 * conversation id the old runtime served, and `model` and `thinkingLevel` are
 * the current choices, which can differ from the launch flags.
 */
export type ManagedSdkRestart = {
  resume: string;
  model: string;
  thinkingLevel?: string;
};

/** Shown when a turn replaced a dead agent process and kept the conversation. */
const AGENT_NAMES: Record<ManagedSdkAgent, string> = {
  grok: "Grok",
  cursor: "Cursor",
  fx: "fx",
  muse: "Muse",
  deepseek: "DeepSeek",
  devin: "Devin",
  antigravity: "Antigravity",
  copilot: "Copilot",
  jcode: "jcode",
};

export function managedRestartResumedNotice(agent: ManagedSdkAgent): string {
  const name = AGENT_NAMES[agent];
  return `The ${name} process for this session had stopped. omg.dev started it again and resumed the same conversation.`;
}

/** Shown when the replacement could not resume, so the agent starts fresh. */
export function managedRestartFreshNotice(agent: ManagedSdkAgent): string {
  const name = AGENT_NAMES[agent];
  return `The ${name} process for this session had stopped. omg.dev started it again, but ${name} could not resume the conversation, so it does not remember the earlier messages.`;
}

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
  createRuntime(sink: ManagedSdkEventSink, restart?: ManagedSdkRestart): Promise<ManagedSdkRuntime>;
  /** Defaults to process.exit. Tests replace this so shutdown can return. */
  exitProcess?: (code: number) => void;
  /** Tests shorten the quiet windows of activity outside a turn. */
  backgroundQuietMs?: number;
  backgroundToolMs?: number;
};

/**
 * Activity outside a turn has no end signal, so it ends after this much quiet.
 * Gemini pauses a few seconds between steps; 20 seconds covers that.
 */
const BACKGROUND_QUIET_MS = 20_000;
/** A tool call that started outside a turn and has not finished yet. */
const BACKGROUND_TOOL_MS = 10 * 60_000;

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
    backgroundQuietMs = BACKGROUND_QUIET_MS,
    backgroundToolMs = BACKGROUND_TOOL_MS,
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
  // True while a turn that a person sent runs. Agent activity outside one is
  // tracked below so the session still reads as working.
  let turnActive = false;
  const background = {
    active: false,
    openTools: new Set<string>(),
    timer: null as ReturnType<typeof setTimeout> | null,
  };
  let promptResolver: ((index: number | null) => void) | null = null;
  let openPrompt: AisdkPrompt | null = null;
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
    notice(body) {
      if (!closing && body.trim()) indexSessionMessagesDirect(key, [row("assistant", "text", body)]);
    },
    draft(next) {
      if (next) noteBackgroundActivity();
      draft = next;
      publishDraft(next, false, "text");
    },
    thinking(next) {
      if (next) noteBackgroundActivity();
      thought = next;
      if (!draft) publishDraft(next, false, "thinking");
    },
    commitText(next) {
      if (next.trim()) noteBackgroundActivity();
      const body = next.trim();
      draft = "";
      publishDraft("", true);
      if (!body) return;
      indexSessionMessagesDirect(key, [row("assistant", "text", body)]);
    },
    toolStart(id, name, input) {
      noteBackgroundActivity({ start: id });
      const toolId = `${id}:start`;
      if (emittedTools.has(toolId)) return;
      emittedTools.add(toolId);
      const detail = clipped(input);
      indexSessionMessagesDirect(key, [
        row("assistant", "tool_use", detail ? `${name}: ${detail}` : name, toolId),
      ]);
    },
    toolEnd(id, name, output, error = false) {
      noteBackgroundActivity({ end: id });
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
      openPrompt = prompt;
      patchEntry(key, { busy: false, prompt, draftText: null, draftKind: null, draftUpdatedAt: null });
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

  /**
   * Agent output that arrives while no turn runs. Antigravity does this: a
   * turn ends while a command it started still runs in the background, and
   * when the command finishes, agy continues with more tool calls and text on
   * its own. Without this the session reads as idle the whole time (seen on
   * 2026-11-18). The session is busy until the activity goes quiet.
   */
  function noteBackgroundActivity(tool?: { start?: string; end?: string }): void {
    if (turnActive || closing) return;
    if (tool?.start) background.openTools.add(tool.start);
    if (tool?.end) background.openTools.delete(tool.end);
    if (!background.active) {
      background.active = true;
      patchEntry(key, { busy: true });
    }
    if (background.timer) clearTimeout(background.timer);
    background.timer = setTimeout(
      () => settleBackground(true),
      background.openTools.size ? backgroundToolMs : backgroundQuietMs,
    );
  }

  /**
   * End activity outside a turn: commit the text it streamed, which no turn
   * result will carry, and clear the draft. `idle` also clears busy; a turn
   * that is about to start sets busy itself.
   */
  function settleBackground(idle: boolean): void {
    if (background.timer) clearTimeout(background.timer);
    background.timer = null;
    if (!background.active) return;
    background.active = false;
    background.openTools.clear();
    const held = runtime?.takeDraft?.() ?? { text: draft, thinking: thought };
    const rows: SessionMsg[] = [];
    if (held.thinking.trim()) rows.push(row("assistant", "thinking", clipped(held.thinking.trim())));
    if (held.text.trim()) rows.push(row("assistant", "text", held.text.trim()));
    if (rows.length && !closing) indexSessionMessagesDirect(key, rows);
    draft = "";
    thought = "";
    publishDraft("", true);
    if (idle && !closing && !promptResolver) patchEntry(key, { busy: false });
  }

  /**
   * The runtime for the next turn. The agent process behind a runtime can end
   * while the session waits: a crash, an out-of-memory kill, or a shell that
   * signals every copy of the agent by name (`pkill -f "agy acp"` did this to
   * idle Antigravity sessions on 2026-11-18). Its pipe is then dead, and a
   * turn sent on it fails at once with "ACP connection closed". So this
   * starts a replacement that resumes the same native conversation. A process
   * that dies DURING a turn still fails that turn: the prompt may already have
   * run tools, so it is not sent twice.
   */
  async function liveRuntime(): Promise<ManagedSdkRuntime> {
    const current = runtime!;
    if (!current.alive || current.alive()) return current;
    try {
      await current.close();
    } catch {}
    const previous = current.nativeSessionId;
    const next = await options.createRuntime(sink, { resume: previous, model, thinkingLevel });
    runtime = next;
    if (next.nativeSessionId && next.nativeSessionId !== previous) {
      patchEntry(key, { threadId: next.nativeSessionId });
    }
    sink.notice?.(
      previous && next.nativeSessionId === previous
        ? managedRestartResumedNotice(agent)
        : managedRestartFreshNotice(agent),
    );
    return next;
  }

  async function runTurn(prompt: string): Promise<void> {
    if (!runtime) return;
    indexSessionMessagesDirect(key, [row("user", "text", prompt)]);
    draft = "";
    thought = "";
    publishDraft("", true);
    try {
      const current = await liveRuntime();
      const result = await current.runTurn(prompt, sink);
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
        settleBackground(false);
        turnActive = true;
        patchEntry(key, { busy: true, prompt: null, draftText: null, draftKind: null, draftUpdatedAt: null });
        try {
          await runTurn(prompt);
        } finally {
          turnActive = false;
          if (!closing) patchEntry(key, { busy: false, prompt: null, draftText: null, draftKind: null, draftUpdatedAt: null });
        }
      }
    } finally {
      draining = false;
    }
  }

  async function shutdown(): Promise<void> {
    if (closing) return;
    closing = true;
    if (background.timer) clearTimeout(background.timer);
    background.timer = null;
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
      if (!command.text.trim()) return;
      // A message sent while a question is open answers it. The iOS card sends
      // the chosen label this way, and a queued message would wait behind a
      // question that never resolves. An exact label picks that option; other
      // text closes the question and goes to the agent as the next message.
      if (promptResolver) {
        const resolve = promptResolver;
        const index = optionIndexForText(openPrompt, command.text);
        promptResolver = null;
        openPrompt = null;
        patchEntry(key, { prompt: null, busy: true });
        resolve(index);
        if (index !== null) return;
      }
      queue.push(command.text);
      void drain();
      return;
    }
    if (command.type === "interrupt") {
      promptResolver?.(null);
      promptResolver = null;
      openPrompt = null;
      void runtime?.interrupt();
      return;
    }
    if (command.type === "answer") {
      const resolve = promptResolver;
      promptResolver = null;
      openPrompt = null;
      patchEntry(key, { prompt: null, busy: true });
      resolve?.(command.index);
      return;
    }
    if (command.type === "dismiss") {
      const resolve = promptResolver;
      promptResolver = null;
      openPrompt = null;
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
