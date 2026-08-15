// Long-lived Grok Build session through its native ACP stdio server.
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { omgAcpMcpServers } from "./acp-mcp.ts";
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

function grokPath(): string {
  return process.env.LFG_GROK_PATH || Bun.which("grok") || "grok";
}

export async function cmdGrokAcpSession(argv: string[]): Promise<void> {
  const key = arg(argv, "--key");
  const cwd = arg(argv, "--cwd") ?? process.cwd();
  const model = arg(argv, "--model") ?? "grok-code-fast-1";
  const managedName = arg(argv, "--managed-name") ?? "";
  const resume = arg(argv, "--resume");
  const thinkingLevel = arg(argv, "--thinking-level");
  const recoveredAt = Number(arg(argv, "--recovered-at")) || null;
  const separator = argv.indexOf("--");
  const initialPrompt = separator >= 0 ? argv.slice(separator + 1).join(" ").trim() : "";
  if (!key) throw new Error("grok-acp-session: --key <uuid> is required");

  await runManagedSdkSession({
    key,
    agent: "grok",
    cwd,
    model,
    managedName,
    resume,
    thinkingLevel,
    recoveredAt,
    initialPrompt,
    async createRuntime(sink) {
      const childArgs = ["agent", "--always-approve"];
      if (model) childArgs.push("--model", model);
      if (thinkingLevel) childArgs.push("--effort", thinkingLevel);
      childArgs.push("stdio");
      const child = spawn(grokPath(), childArgs, {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "inherit"],
      });
      if (!child.stdin || !child.stdout) throw new Error("Grok ACP stdio was not available");
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      const state: AcpUpdateState = { draft: "", thought: "", replaying: false };
      const app = acp.client({ name: "lfg" })
        .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
          const choices = params.options.map((option) => ({
            label: option.name ?? option.optionId,
            description: option.kind,
          }));
          const selected = await sink.ask(params.toolCall.title ?? "Grok tool permission", choices, "Grok permission");
          if (selected == null) return { outcome: { outcome: "cancelled" } };
          return {
            outcome: { outcome: "selected", optionId: params.options[selected]!.optionId },
          };
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
        mcpServers: omgAcpMcpServers(key),
        resume,
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
        async close() {
          if (opened.methods.close) {
            try {
              await connection.agent.request(acp.methods.agent.session.close, { sessionId });
            } catch {}
          }
          connection.close();
          child.kill();
        },
      };
    },
  });
}

if (import.meta.main) {
  cmdGrokAcpSession(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
