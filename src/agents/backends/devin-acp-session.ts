// Long-lived Devin CLI session through its ACP stdio server (`devin acp`).
// Devin's `-p` print mode is one-shot per invocation. The ACP server keeps one
// agent alive for the lifetime of this managed omg.dev session, so follow-up
// prompts share context and cancellation stays immediate. Credentials come from
// `devin auth login` (~/.local/share/devin/credentials.toml) or WINDSURF_API_KEY.
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

export function devinHarnessPath(): string {
  const override = process.env.LFG_DEVIN_PATH?.trim();
  if (override) return override;
  return Bun.which("devin") || join(homedir(), ".local", "bin", "devin");
}

export function devinHarnessArgv(model: string): string[] {
  // `devin acp` resolves the same fuzzy model names as the interactive CLI
  // ("adaptive", "opus", "swe"); DEVIN_MODEL is the documented env fallback.
  return ["acp", "--model", model];
}

export async function cmdDevinAcpSession(argv: string[]): Promise<void> {
  const key = arg(argv, "--key");
  const cwd = arg(argv, "--cwd") ?? process.cwd();
  const model = arg(argv, "--model") ?? "adaptive";
  const managedName = arg(argv, "--managed-name") ?? "";
  const recoveredAt = Number(arg(argv, "--recovered-at")) || null;
  const separator = argv.indexOf("--");
  const initialPrompt = separator >= 0 ? argv.slice(separator + 1).join(" ").trim() : "";
  if (!key) throw new Error("devin-acp-session: --key <uuid> is required");

  await runManagedSdkSession({
    key,
    agent: "devin",
    cwd,
    model,
    managedName,
    recoveredAt,
    initialPrompt,
    async createRuntime(sink) {
      const child = spawn(devinHarnessPath(), devinHarnessArgv(model), {
        cwd,
        env: {
          ...process.env,
          DEVIN_MODEL: model,
        },
        stdio: ["pipe", "pipe", "inherit"],
      });
      if (!child.stdin || !child.stdout) throw new Error("Devin ACP stdio was not available");
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
            params.toolCall.title ?? "Devin tool permission",
            choices,
            "Devin permission",
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
        // Devin reads its MCP servers from its own `devin mcp` configuration.
        // Client-supplied servers over ACP are unverified, so none are passed.
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
  cmdDevinAcpSession(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
