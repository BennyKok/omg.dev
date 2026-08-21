// Long-lived JCode session through its official TypeScript harness SDK.
import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { JcodeClient, type ApiEvent } from "@1jehuang/jcode-sdk";
import { PATHS } from "../../config.ts";
import {
  runManagedSdkSession,
  type ManagedSdkEventSink,
} from "./managed-sdk-session.ts";

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function eventToSink(event: ApiEvent, sink: ManagedSdkEventSink, state: { draft: string; thought: string }): void {
  switch (event.ev) {
    case "text_delta":
      state.draft += event.text;
      sink.draft(state.draft);
      break;
    case "reasoning_delta":
      state.thought += event.text;
      sink.thinking(state.thought);
      break;
    case "tool_start":
      sink.toolStart(event.call_id, event.name);
      break;
    case "tool_done":
      sink.toolEnd(event.call_id, event.name, event.error || event.output, !!event.error);
      break;
    default:
      break;
  }
}

export async function cmdJcodeSdkSession(argv: string[]): Promise<void> {
  const key = arg(argv, "--key");
  const cwd = arg(argv, "--cwd") ?? process.cwd();
  const model = arg(argv, "--model") ?? "auto";
  const managedName = arg(argv, "--managed-name") ?? "";
  const resume = arg(argv, "--resume");
  const thinkingLevel = arg(argv, "--thinking-level");
  const recoveredAt = Number(arg(argv, "--recovered-at")) || null;
  const separator = argv.indexOf("--");
  const initialPrompt = separator >= 0 ? argv.slice(separator + 1).join(" ").trim() : "";
  if (!key) throw new Error("jcode-sdk-session: --key <uuid> is required");

  await runManagedSdkSession({
    key,
    agent: "jcode",
    cwd,
    model,
    managedName,
    resume,
    thinkingLevel,
    recoveredAt,
    initialPrompt,
    async createRuntime(sink) {
      const jcodeHome = join(PATHS.data, "jcode-sdk", key);
      await mkdir(jcodeHome, { recursive: true });
      try {
        await copyFile(join(homedir(), ".jcode", "mcp.json"), join(jcodeHome, "mcp.json"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const client = await JcodeClient.launch({
        workingDir: cwd,
        jcodeHome,
        inheritLogins: true,
      });
      const session = resume
        ? await client.attachSession(resume)
        : await client.createSession(cwd);
      if (model && model !== "auto") await client.setModel(session.session_id, model);
      if (thinkingLevel) await client.setReasoningEffort(session.session_id, thinkingLevel);
      return {
        nativeSessionId: session.session_id,
        async runTurn(prompt) {
          const state = { draft: "", thought: "" };
          const result = await client.run(session.session_id, prompt, {
            autoApprove: true,
            onEvent: (event) => eventToSink(event, sink, state),
          });
          for (const tool of result.toolCalls) {
            sink.toolEnd(tool.callId, tool.name, tool.error || tool.output, !!tool.error);
          }
          return { text: result.text, thinking: result.reasoning };
        },
        interrupt: () => client.cancel(session.session_id),
        close: () => client.close(),
        setModel: (next) => client.setModel(session.session_id, next),
        setThinkingLevel: (next) => client.setReasoningEffort(session.session_id, next),
      };
    },
  });
}

if (import.meta.main) {
  cmdJcodeSdkSession(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
