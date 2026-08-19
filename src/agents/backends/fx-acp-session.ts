// Long-lived Vercel fx session through the CLI's native ACP stdio server.
// fx has no TypeScript SDK: `fx acp` is the only structured surface, and it
// reuses the existing `fx login` / AI_GATEWAY_API_KEY credential, so ACP is
// both the supported and the cheapest integration.
//
// fx advertises loadSession + session/resume + session/close, so the shared
// bindAcpConversation picks session/resume for recovery without replaying the
// transcript. Its MCP capability is http/sse only (no stdio), which is exactly
// the shape omgAcpMcpServers already emits.
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

function fxPath(): string {
  return process.env.LFG_FX_PATH || Bun.which("fx") || "fx";
}

// fx ships two ACP session modes: `ask` (default) prompts before every change,
// `code` grants full tool access under its `auto` permission policy. Grok and
// Cursor get the same effect from --always-approve and --trust. fx has no such
// launch flag, so LFG selects the mode over the wire right after the session
// opens. Remaining permission requests still reach the dashboard prompt.
const FX_SESSION_MODE = "code";

/**
 * `fx acp` takes `[--model <id>] [--log-file <path>]` and nothing else.
 * "auto" is LFG's cross-agent placeholder for "the provider's own default", not
 * an AI Gateway model id, so it must not be forwarded — fx would reject it.
 */
export function fxAcpChildArgs(model?: string): string[] {
  const args = ["acp"];
  if (model && model !== "auto") args.push("--model", model);
  return args;
}

export async function cmdFxAcpSession(argv: string[]): Promise<void> {
  const key = arg(argv, "--key");
  const cwd = arg(argv, "--cwd") ?? process.cwd();
  const model = arg(argv, "--model") ?? "auto";
  const managedName = arg(argv, "--managed-name") ?? "";
  const resume = arg(argv, "--resume");
  const recoveredAt = Number(arg(argv, "--recovered-at")) || null;
  const separator = argv.indexOf("--");
  const initialPrompt = separator >= 0 ? argv.slice(separator + 1).join(" ").trim() : "";
  if (!key) throw new Error("fx-acp-session: --key <uuid> is required");

  await runManagedSdkSession({
    key,
    agent: "fx",
    cwd,
    model,
    managedName,
    resume,
    recoveredAt,
    initialPrompt,
    async createRuntime(sink) {
      const child = spawn(fxPath(), fxAcpChildArgs(model), {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "inherit"],
      });
      if (!child.stdin || !child.stdout) throw new Error("fx ACP stdio was not available");
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      const state: AcpUpdateState = { draft: "", thought: "", replaying: false };
      const app = acp.client({ name: "lfg" })
        .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
          const selected = await sink.ask(
            params.toolCall.title ?? "fx tool permission",
            params.options.map((option) => ({ label: option.name ?? option.optionId, description: option.kind })),
            "fx permission",
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
      // Best effort: an older fx without the mode registry must not abort the
      // launch. It only means the session keeps asking before each change.
      try {
        await connection.agent.request(acp.methods.agent.session.setMode, {
          sessionId,
          modeId: FX_SESSION_MODE,
        });
      } catch {}
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
  cmdFxAcpSession(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
