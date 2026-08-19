// Long-lived Cursor session through the CLI's official ACP stdio server.
// Cursor's TypeScript SDK requires a separate API key. ACP keeps the existing
// authenticated CLI account and still provides typed structured lifecycle I/O.
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { omgAcpMcpServers } from "./acp-mcp.ts";
import {
  applyAcpSessionUpdate,
  bindAcpConversation,
  type AcpUpdateState,
} from "./acp-session.ts";
import { registerCursorExtensionHandlers } from "./cursor-acp-extensions.ts";
import { runManagedSdkSession } from "./managed-sdk-session.ts";

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function cursorPath(): string {
  return process.env.LFG_CURSOR_PATH || Bun.which("cursor-agent") || Bun.which("agent") || "cursor-agent";
}

export async function cmdCursorAcpSession(argv: string[]): Promise<void> {
  const key = arg(argv, "--key");
  const cwd = arg(argv, "--cwd") ?? process.cwd();
  const model = arg(argv, "--model") ?? "auto";
  const managedName = arg(argv, "--managed-name") ?? "";
  const resume = arg(argv, "--resume");
  const recoveredAt = Number(arg(argv, "--recovered-at")) || null;
  const separator = argv.indexOf("--");
  const initialPrompt = separator >= 0 ? argv.slice(separator + 1).join(" ").trim() : "";
  if (!key) throw new Error("cursor-acp-session: --key <uuid> is required");

  await runManagedSdkSession({
    key,
    agent: "cursor",
    cwd,
    model,
    managedName,
    resume,
    recoveredAt,
    initialPrompt,
    async createRuntime(sink) {
      // `--force` (alias `--yolo`) is a root flag, so it goes before the `acp`
      // subcommand, the same as `--trust` and `--model`. Without it the ACP
      // server raises session/request_permission per tool call, which we would
      // have to put to the user as a dashboard question. A managed session is
      // meant to run unattended, and every other managed backend already skips
      // per-tool approval: claude-ai-sdk.ts and aisdk-session.ts use
      // `bypassPermissions`, grok-cli.ts uses `bypassPermissions`, fx-cli.ts and
      // cursor-cli.ts use `--yolo`, and the Cursor TUI pane in tmux.ts uses
      // `--yolo --sandbox disabled`. This keeps Cursor on ACP, with no tmux
      // pane, and drops the prompts.
      // The session.requestPermission handler below stays as a fallback for any
      // prompt the server raises regardless.
      const childArgs = ["--force", "--trust"];
      if (model && model !== "auto") childArgs.push("--model", model);
      childArgs.push("acp");
      const child = spawn(cursorPath(), childArgs, {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "inherit"],
      });
      if (!child.stdin || !child.stdout) throw new Error("Cursor ACP stdio was not available");
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      const state: AcpUpdateState = { draft: "", thought: "", replaying: false };
      const app = registerCursorExtensionHandlers(acp.client({ name: "lfg" }), sink)
        .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
          const selected = await sink.ask(
            params.toolCall.title ?? "Cursor tool permission",
            params.options.map((option) => ({ label: option.name ?? option.optionId, description: option.kind })),
            "Cursor permission",
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
  cmdCursorAcpSession(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
