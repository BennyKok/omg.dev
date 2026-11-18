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
import { runManagedSdkSession } from "./managed-sdk-session.ts";
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
    async createRuntime(sink) {
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
      const state: AcpUpdateState = { draft: "", thought: "", replaying: false };
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
      const shutdown = () => {
        connection.close();
        child.kill();
      };
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
        shutdown();
        if (isAcpAuthRequired(error)) throw new Error(ANTIGRAVITY_SIGN_IN_HINT);
        throw error;
      }
      const sessionId = opened.sessionId;
      const configOptions = opened.configOptions;

      // Model and thinking level are ACP session options whose values belong
      // to the signed-in plan. Apply a choice only when the agent offers it;
      // otherwise keep the account default and say so, never fail the session.
      const applyChoice = async (category: string, wanted: string, label: string) => {
        const choice = resolveAcpConfigChoice(configOptions, category, wanted);
        if (!choice) {
          sink.notice?.(`Antigravity does not offer ${label} "${wanted}" for this account. It keeps its default.`);
          return;
        }
        await connection.agent.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
          configId: choice.configId,
          value: choice.value,
        });
      };
      // A level above the plan's ceiling clamps to what the plan offers, and
      // says so, instead of quietly keeping the account default.
      const applyThinking = async (wanted: string) => {
        const level = antigravityClampedLevel(configOptions, wanted);
        if (!level) {
          sink.notice?.(`Antigravity does not offer thinking level "${wanted}" for this account. It keeps its default.`);
          return;
        }
        if (level.value.toLowerCase() !== antigravityThinkingValue(wanted).toLowerCase()) {
          sink.notice?.(
            `Antigravity offers thinking levels up to ${level.name} on this account. It uses that instead of "${wanted}".`,
          );
        }
        await connection.agent.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
          configId: level.configId,
          value: level.value,
        });
      };
      if (model && model !== "default") await applyChoice("model", model, "model");
      if (thinkingLevel) await applyThinking(thinkingLevel);

      return {
        nativeSessionId: sessionId,
        async runTurn(prompt) {
          state.draft = "";
          state.thought = "";
          await connection.agent.request(acp.methods.agent.session.prompt, {
            sessionId,
            prompt: [{ type: "text", text: prompt }],
          });
          if (ANTIGRAVITY_VERIFICATION_REPLY.test(state.draft)) {
            const { verifyUrl } = await probeAntigravityAccount(antigravityHarnessPath());
            sink.notice?.(antigravityVerificationNotice(verifyUrl));
          }
          return { text: state.draft, thinking: state.thought };
        },
        interrupt: () => connection.agent.notify(acp.methods.agent.session.cancel, { sessionId }),
        setThinkingLevel: (level) => applyThinking(level),
        async close() {
          if (opened.methods.close) {
            try {
              await connection.agent.request(acp.methods.agent.session.close, { sessionId });
            } catch {}
          }
          shutdown();
        },
      };
    },
  });
}

if (import.meta.main) {
  cmdAntigravityAcpSession(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
