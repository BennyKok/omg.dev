// Long-lived Google Antigravity session through Google's official ACP server
// (`agy acp`). This is the path Google's Antigravity team named as permitted
// for a personal Google AI plan: a single-user interactive client that runs the
// official, unmodified binary with its own Google sign-in. omg.dev never reads,
// copies or forwards the Google OAuth credentials. `agy` owns them.
//
// What omg.dev does NOT do here, on purpose:
// - no `--dangerously-skip-permissions`: every tool permission the agent asks
//   for goes to the person through the normal question flow;
// - no `agy -p` print-mode wrapping and no direct Cloud Code API calls, which
//   Google says are unsupported on consumer plans.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { omgAcpMcpServers } from "./acp-mcp.ts";
import {
  applyAcpSessionUpdate,
  bindAcpConversation,
  resolveAcpConfigChoice,
  type AcpUpdateState,
} from "./acp-session.ts";
import { runManagedSdkSession } from "./managed-sdk-session.ts";

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
 */
export function antigravityHarnessArgv(): string[] {
  return ["acp", "--process-per-session"];
}

/** omg.dev's "xhigh" is the level Antigravity names "Extra". */
export function antigravityThinkingValue(level: string): string {
  return level === "xhigh" ? "extra" : level;
}

/** The text shown when `agy` has no usable Google login. */
export const ANTIGRAVITY_SIGN_IN_HINT =
  "Antigravity is not signed in. Open Settings, choose the antigravity agent and use Login to sign in with Google, or run `agy acp --login` in a terminal.";

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
        env: process.env,
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
      if (model && model !== "default") await applyChoice("model", model, "model");
      if (thinkingLevel) await applyChoice("thought_level", antigravityThinkingValue(thinkingLevel), "thinking level");

      return {
        nativeSessionId: sessionId,
        async runTurn(prompt) {
          state.draft = "";
          state.thought = "";
          await connection.agent.request(acp.methods.agent.session.prompt, {
            sessionId,
            prompt: [{ type: "text", text: prompt }],
          });
          return { text: state.draft, thinking: state.thought };
        },
        interrupt: () => connection.agent.notify(acp.methods.agent.session.cancel, { sessionId }),
        setThinkingLevel: (level) => applyChoice("thought_level", antigravityThinkingValue(level), "thinking level"),
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
