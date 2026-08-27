// Long-lived DeepSeek Harness session through its official ACP stdio plugin.
// DeepSeek's shipped headless profile is intentionally one-shot. The ACP
// profile keeps one Agent alive for the lifetime of this managed omg.dev
// session, so follow-up prompts share context and cancellation stays immediate.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import {
  applyAcpSessionUpdate,
  bindAcpConversation,
  type AcpUpdateState,
} from "./acp-session.ts";
import { runManagedSdkSession } from "./managed-sdk-session.ts";

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function deepseekHarnessPath(): string {
  const override = process.env.LFG_DEEPSEEK_PATH?.trim();
  if (override) return override;
  return Bun.which("dsh") || join(homedir(), ".bun", "bin", "dsh");
}

export function deepseekHarnessArgv(patchPath: string): string[] {
  return ["--profile", "omg", "--patch", patchPath];
}

export async function cmdDeepseekAcpSession(argv: string[]): Promise<void> {
  const key = arg(argv, "--key");
  const cwd = arg(argv, "--cwd") ?? process.cwd();
  const model = arg(argv, "--model") ?? "deepseek-v4-flash";
  const managedName = arg(argv, "--managed-name") ?? "";
  const recoveredAt = Number(arg(argv, "--recovered-at")) || null;
  const separator = argv.indexOf("--");
  const initialPrompt = separator >= 0 ? argv.slice(separator + 1).join(" ").trim() : "";
  if (!key) throw new Error("deepseek-acp-session: --key <uuid> is required");

  await runManagedSdkSession({
    key,
    agent: "deepseek",
    cwd,
    model,
    managedName,
    recoveredAt,
    initialPrompt,
    async createRuntime(sink) {
      const patchPath = join(import.meta.dir, "../../../config/deepseek-acp.patch.yml");
      const child = spawn(deepseekHarnessPath(), deepseekHarnessArgv(patchPath), {
        cwd,
        env: {
          ...process.env,
          DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE || "danger-full-access",
          LFG_DEEPSEEK_MODEL: model,
        },
        stdio: ["pipe", "pipe", "inherit"],
      });
      if (!child.stdin || !child.stdout) throw new Error("DeepSeek Harness ACP stdio was not available");
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      const state: AcpUpdateState = { draft: "", thought: "", replaying: false };
      const app = acp.client({ name: "omg.dev" })
        .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
          const choices = params.options.map((option) => ({
            label: option.name ?? option.optionId,
            description: option.kind,
          }));
          const selected = await sink.ask(
            params.toolCall.title ?? "DeepSeek tool permission",
            choices,
            "DeepSeek permission",
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
      const opened = await bindAcpConversation({
        context: connection.agent,
        cwd,
        // DeepSeek Harness ACP currently rejects client-supplied MCP servers.
        // Its own profile remains the single owner of model-facing tools.
        mcpServers: [],
        state,
        sink,
      });
      const sessionId = opened.sessionId;
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
        close() {
          connection.close();
          child.kill();
        },
      };
    },
  });
}

if (import.meta.main) {
  cmdDeepseekAcpSession(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
