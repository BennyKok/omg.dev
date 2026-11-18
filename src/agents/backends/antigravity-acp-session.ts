// Long-lived Google Antigravity session through Google's official ACP server
// (`agy acp`). This is the path Google's Antigravity team named as permitted
// for a personal Google AI plan: a single-user interactive client that runs the
// official, unmodified binary with its own Google sign-in. omg.dev never reads,
// copies or forwards the Google OAuth credentials. `agy` owns them.
//
// Tool permissions are accepted automatically, like every other managed
// backend (Claude and the ai-sdk harnesses use `bypassPermissions`, Cursor
// `--force`, Grok `bypassPermissions`). This uses agy's own documented
// `--dangerously-skip-permissions` flag, so the binary stays unmodified, and a
// person still starts every turn. Auto agents stay off this agent.
//
// What omg.dev does NOT do here, on purpose:
// - no `agy -p` print-mode wrapping of prompts and no direct Cloud Code API
//   calls, which Google says are unsupported on consumer plans.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { omgAcpMcpServers } from "./acp-mcp.ts";
import {
  acpConfigChoices,
  applyAcpSessionUpdate,
  bindAcpConversation,
  resolveAcpConfigChoice,
  type AcpUpdateState,
} from "./acp-session.ts";
import {
  runManagedSdkSession,
  type ManagedSdkEventSink,
  type ManagedSdkRuntime,
} from "./managed-sdk-session.ts";
import { recordAntigravityLevels } from "../../model-discovery.ts";
import { ANTIGRAVITY_VERIFICATION_REPLY, probeAntigravityAccount } from "./antigravity-verify.ts";
import { antigravityEnv } from "./antigravity-env.ts";

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function antigravityHarnessPath(): string {
  const override = process.env.LFG_ANTIGRAVITY_PATH?.trim();
  if (override) return override;
  return Bun.which("agy") || join(homedir(), ".local", "bin", "agy");
}

/**
 * `--process-per-session` is what makes `agy acp` advertise
 * `mcpCapabilities.http` (verified against agy 1.5.9), and the omg.dev MCP
 * endpoint is HTTP. Without it the agent would have no omg.dev tools.
 * `--dangerously-skip-permissions` makes agy approve its own tool calls, so a
 * managed session does not stop on a question for each command or edit.
 */
export function antigravityHarnessArgv(): string[] {
  return ["acp", "--process-per-session", "--dangerously-skip-permissions"];
}

type PermissionOption = { optionId: string; kind?: string | null };

/**
 * The option to pick when agy still raises a permission request despite the
 * flag: an "allow always" option first, then "allow once". Null when agy
 * offers no allow option, so the request goes to the person instead.
 */
export function antigravityAutoAllowOption(options: readonly PermissionOption[]): string | null {
  const always = options.find((option) => option.kind === "allow_always");
  if (always) return always.optionId;
  const once = options.find((option) => option.kind === "allow_once");
  return once ? once.optionId : null;
}

/** omg.dev's "xhigh" is the level Antigravity names "Extra". */
export function antigravityThinkingValue(level: string): string {
  return level === "xhigh" ? "extra" : level;
}

/** omg.dev's rank for a level, over Antigravity's ACP value ids. */
const ANTIGRAVITY_LEVEL_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  extra: 3,
  max: 4,
};

/**
 * A Google plan offers a subset of Antigravity's vocabulary: a plan whose
 * models stop at High has no Extra, and Max is rarer still. `agy` refuses a
 * level it did not list, so a stored "xhigh" would otherwise be dropped and
 * the session silently run on the account default. Clamp to the highest level
 * the plan offers at or below the ask instead — the same convention
 * grokEffortFor and piThinkingFor use. Null keeps the account default: the
 * option is missing, or the ask is not a level this vocabulary can rank.
 */
export function antigravityClampedLevel(
  options: readonly acp.SessionConfigOption[],
  wanted: string,
): { configId: string; value: string; name: string } | null {
  const offered = acpConfigChoices(options, "thought_level");
  if (!offered) return null;
  const acpWanted = antigravityThinkingValue(wanted).toLowerCase();
  const exact = offered.choices.find((choice) => choice.value.toLowerCase() === acpWanted);
  if (exact) return { configId: offered.configId, value: exact.value, name: exact.name ?? exact.value };
  const rank = ANTIGRAVITY_LEVEL_RANK[acpWanted];
  if (rank == null) return null;
  const candidates = offered.choices.filter(
    (choice) => (ANTIGRAVITY_LEVEL_RANK[choice.value] ?? -1) <= rank && ANTIGRAVITY_LEVEL_RANK[choice.value] != null,
  );
  const best = [...candidates].sort(
    (a, b) => ANTIGRAVITY_LEVEL_RANK[b.value]! - ANTIGRAVITY_LEVEL_RANK[a.value]!,
  )[0];
  return best ? { configId: offered.configId, value: best.value, name: best.name ?? best.value } : null;
}

/** Antigravity's level ids, as omg.dev stores them. */
const ACP_LEVEL_TO_OMG: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  extra: "xhigh",
  xhigh: "xhigh",
  max: "max",
};

/**
 * The levels agy offered the session, in omg.dev's vocabulary and canonical
 * order. An empty list means the account offered no Thinking option this
 * session could express — worth recording too, so the picker hides the knob
 * for that model instead of offering levels the plan never applies.
 */
export function antigravityOfferedLevels(options: readonly acp.SessionConfigOption[]): string[] {
  const offered = acpConfigChoices(options, "thought_level");
  const seen = new Set<string>();
  for (const choice of offered?.choices ?? []) {
    const level = ACP_LEVEL_TO_OMG[choice.value.toLowerCase()];
    if (level) seen.add(level);
  }
  return ["low", "medium", "high", "xhigh", "max"].filter((level) => seen.has(level));
}

/** The text shown when `agy` has no usable Google login. */
export const ANTIGRAVITY_SIGN_IN_HINT =
  "Antigravity is not signed in. Open Settings, choose the antigravity agent and use Login to sign in with Google, or run `agy acp --login` in a terminal.";

/**
 * What to tell the person when agy answers only "Verification Required".
 * Google needs a browser check on the account; the link comes from agy's log.
 */
export function antigravityVerificationNotice(verifyUrl: string | null): string {
  const where = verifyUrl
    ? `Open this page, signed in as the same Google account, and finish the check: ${verifyUrl}`
    : "Open Settings, choose the antigravity agent, and use Verify account.";
  return `Google asks you to verify this account before Antigravity can answer. ${where} Then send your message again.`;
}

export function isAcpAuthRequired(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  return record.code === -32000 || /authentication required/i.test(String(record.message ?? ""));
}

export type AntigravityRuntimeOptions = {
  key: string;
  cwd: string;
  model: string;
  thinkingLevel?: string;
  resume?: string;
  /** Tests replace this so they do not write the real discovery cache. */
  recordLevels?: (model: string, levels: string[]) => Promise<unknown>;
};

/** Shown when a turn had to start a new `agy` because the old one was gone. */
export const ANTIGRAVITY_RESTARTED_NOTICE =
  "The Antigravity process for this session had stopped. omg.dev started it again and resumed the same conversation.";

type AntigravityLink = {
  child: ReturnType<typeof spawn>;
  connection: ReturnType<ReturnType<typeof acp.client>["connect"]>;
  sessionId: string;
  configOptions: acp.SessionConfigOption[];
  canClose: boolean;
  /** False once the `agy` process exits, for any reason. */
  alive: boolean;
  shutdown(): void;
};

/**
 * One managed Antigravity session over `agy acp`.
 *
 * The session owns its `agy` child, and that child can end while the session
 * waits for the next message: a crash, an out-of-memory kill, or any process
 * on the box that signals every `agy` (`pkill -f "agy acp"` from a debugging
 * shell did exactly this on 2026-11-18). The pipe is then dead, and a turn
 * sent on it fails at once with "ACP connection closed". So each turn checks
 * the child first. When it is gone, the turn starts a new `agy` and resumes
 * the same Antigravity conversation by id, then re-applies the model and the
 * current thinking level. A child that dies DURING a turn still fails that
 * turn: the prompt may have run tools, so it is not sent twice.
 */
export async function createAntigravityRuntime(
  options: AntigravityRuntimeOptions,
  sink: ManagedSdkEventSink,
): Promise<ManagedSdkRuntime> {
  const { key, cwd, model } = options;
  const recordLevels = options.recordLevels ?? recordAntigravityLevels;
  let thinkingLevel = options.thinkingLevel;
  const state: AcpUpdateState = { draft: "", thought: "", replaying: false };

  async function open(resume: string | undefined, quiet: boolean): Promise<AntigravityLink> {
    const child = spawn(antigravityHarnessPath(), antigravityHarnessArgv(), {
      cwd,
      env: antigravityEnv(),
      stdio: ["pipe", "pipe", "inherit"],
    });
    if (!child.stdin || !child.stdout) throw new Error("Antigravity ACP stdio was not available");
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const app = acp.client({ name: "omg.dev" })
      .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
        const allow = antigravityAutoAllowOption(params.options);
        if (allow) return { outcome: { outcome: "selected", optionId: allow } };
        const selected = await sink.ask(
          params.toolCall.title ?? "Antigravity tool permission",
          params.options.map((option) => ({ label: option.name ?? option.optionId, description: option.kind })),
          "Antigravity permission",
        );
        if (selected == null) return { outcome: { outcome: "cancelled" } };
        return { outcome: { outcome: "selected", optionId: params.options[selected]!.optionId } };
      })
      .onRequest(acp.methods.client.fs.readTextFile, async ({ params }) => ({
        content: await Bun.file(params.path).text(),
      }))
      .onRequest(acp.methods.client.fs.writeTextFile, async ({ params }) => {
        await Bun.write(params.path, params.content);
        return {};
      })
      .onNotification(acp.methods.client.session.update, async ({ params }) => {
        applyAcpSessionUpdate(params.update, sink, state);
      });
    const connection = app.connect(stream);
    const link: AntigravityLink = {
      child,
      connection,
      sessionId: "",
      configOptions: [],
      canClose: false,
      alive: true,
      shutdown() {
        connection.close();
        child.kill();
      },
    };
    child.once("exit", () => {
      link.alive = false;
    });
    child.once("error", () => {
      link.alive = false;
    });

    let opened: Awaited<ReturnType<typeof bindAcpConversation>>;
    try {
      opened = await bindAcpConversation({
        context: connection.agent,
        cwd,
        mcpServers: omgAcpMcpServers(key),
        resume,
        state,
        sink,
      });
    } catch (error) {
      link.shutdown();
      if (isAcpAuthRequired(error)) throw new Error(ANTIGRAVITY_SIGN_IN_HINT);
      throw error;
    }
    link.sessionId = opened.sessionId;
    link.configOptions = opened.configOptions;
    link.canClose = opened.methods.close;

    // Model and thinking level are ACP session options whose values belong
    // to the signed-in plan. Apply a choice only when the agent offers it;
    // otherwise keep the account default and say so, never fail the session.
    // A restart re-applies them quietly: the person saw these notices once.
    if (model && model !== "default") {
      const choice = resolveAcpConfigChoice(link.configOptions, "model", model);
      if (!choice) {
        if (!quiet) sink.notice?.(`Antigravity does not offer model "${model}" for this account. It keeps its default.`);
      } else {
        await connection.agent.request(acp.methods.agent.session.setConfigOption, {
          sessionId: link.sessionId,
          configId: choice.configId,
          value: choice.value,
        });
      }
    }
    if (thinkingLevel) await applyThinking(link, thinkingLevel, quiet);

    // The session is the only place that sees what agy actually offered at
    // open time, so record it for the model that ran. The picker then follows
    // the plan as it changes — discovery's snapshot goes stale between runs,
    // and a model with no Thinking option at all must lose its knob. Never
    // fail the session over this.
    void recordLevels(model, antigravityOfferedLevels(link.configOptions)).catch((error) => {
      console.error(
        `antigravity level record failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return link;
  }

  // A level above the plan's ceiling clamps to what the plan offers, and
  // says so, instead of quietly keeping the account default.
  async function applyThinking(link: AntigravityLink, wanted: string, quiet = false): Promise<void> {
    const level = antigravityClampedLevel(link.configOptions, wanted);
    if (!level) {
      if (!quiet) sink.notice?.(`Antigravity does not offer thinking level "${wanted}" for this account. It keeps its default.`);
      return;
    }
    if (!quiet && level.value.toLowerCase() !== antigravityThinkingValue(wanted).toLowerCase()) {
      sink.notice?.(
        `Antigravity offers thinking levels up to ${level.name} on this account. It uses that instead of "${wanted}".`,
      );
    }
    await link.connection.agent.request(acp.methods.agent.session.setConfigOption, {
      sessionId: link.sessionId,
      configId: level.configId,
      value: level.value,
    });
  }

  let link = await open(options.resume, false);
  const sessionId = link.sessionId;

  /** The live link, after a restart and resume when the old `agy` is gone. */
  async function liveLink(): Promise<AntigravityLink> {
    if (link.alive) return link;
    link.shutdown();
    link = await open(sessionId, true);
    sink.notice?.(ANTIGRAVITY_RESTARTED_NOTICE);
    return link;
  }

  return {
    nativeSessionId: sessionId,
    async runTurn(prompt) {
      const current = await liveLink();
      state.draft = "";
      state.thought = "";
      await current.connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: prompt }],
      });
      if (ANTIGRAVITY_VERIFICATION_REPLY.test(state.draft)) {
        const { verifyUrl } = await probeAntigravityAccount(antigravityHarnessPath());
        sink.notice?.(antigravityVerificationNotice(verifyUrl));
      }
      return { text: state.draft, thinking: state.thought };
    },
    interrupt: () => {
      if (link.alive) return link.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId });
    },
    async setThinkingLevel(level) {
      thinkingLevel = level;
      // A dead link picks the new level up when the next turn reopens it.
      if (link.alive) await applyThinking(link, level);
    },
    async close() {
      if (link.alive && link.canClose) {
        try {
          await link.connection.agent.request(acp.methods.agent.session.close, { sessionId });
        } catch {}
      }
      link.shutdown();
    },
  };
}

export async function cmdAntigravityAcpSession(argv: string[]): Promise<void> {
  const key = arg(argv, "--key");
  const cwd = arg(argv, "--cwd") ?? process.cwd();
  const model = arg(argv, "--model") ?? "default";
  const thinkingLevel = arg(argv, "--thinking-level");
  const managedName = arg(argv, "--managed-name") ?? "";
  const resume = arg(argv, "--resume");
  const recoveredAt = Number(arg(argv, "--recovered-at")) || null;
  const separator = argv.indexOf("--");
  const initialPrompt = separator >= 0 ? argv.slice(separator + 1).join(" ").trim() : "";
  if (!key) throw new Error("antigravity-acp-session: --key <uuid> is required");

  await runManagedSdkSession({
    key,
    agent: "antigravity",
    cwd,
    model,
    managedName,
    resume,
    thinkingLevel,
    recoveredAt,
    initialPrompt,
    createRuntime: (sink) => createAntigravityRuntime({ key, cwd, model, thinkingLevel, resume }, sink),
  });
}

if (import.meta.main) {
  cmdAntigravityAcpSession(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
