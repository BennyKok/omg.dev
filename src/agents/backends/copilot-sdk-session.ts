// Long-lived GitHub Copilot session through the official TypeScript SDK.
import {
  CopilotClient,
  approveAll,
  type PermissionHandler,
  type SessionConfig,
  type SessionEvent,
} from "@github/copilot-sdk";
import { omgMcpServers } from "../../config.ts";
import { runManagedSdkSession } from "./managed-sdk-session.ts";

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function permissionLabel(request: unknown): string {
  const value = request as { kind?: string; toolName?: string; fileName?: string; commands?: unknown };
  return [value.kind, value.toolName, value.fileName, value.commands ? JSON.stringify(value.commands) : ""]
    .filter(Boolean)
    .join(" · ") || "Copilot tool request";
}

export async function cmdCopilotSdkSession(argv: string[]): Promise<void> {
  const key = arg(argv, "--key");
  const cwd = arg(argv, "--cwd") ?? process.cwd();
  const model = arg(argv, "--model") ?? "auto";
  const managedName = arg(argv, "--managed-name") ?? "";
  const resume = arg(argv, "--resume");
  const thinkingLevel = arg(argv, "--thinking-level");
  const recoveredAt = Number(arg(argv, "--recovered-at")) || null;
  const separator = argv.indexOf("--");
  const initialPrompt = separator >= 0 ? argv.slice(separator + 1).join(" ").trim() : "";
  if (!key) throw new Error("copilot-sdk-session: --key <uuid> is required");

  await runManagedSdkSession({
    key,
    agent: "copilot",
    cwd,
    model,
    managedName,
    resume,
    thinkingLevel,
    recoveredAt,
    initialPrompt,
    async createRuntime(sink) {
      const client = new CopilotClient({ workingDirectory: cwd, logLevel: "warning" });
      await client.start();
      const onPermissionRequest: PermissionHandler = process.env.LFG_COPILOT_ALLOW_ALL_TOOLS === "1"
        ? approveAll
        : async (request) => {
            const selected = await sink.ask(
              permissionLabel(request),
              [
                { label: "Allow once" },
                { label: "Allow for session" },
                { label: "Deny" },
              ],
              "Copilot permission",
            );
            if (selected === 0) return { kind: "approve-once", approvedInteractively: true };
            if (selected === 1) return { kind: "approve-for-session" };
            return { kind: "reject", feedback: "The user denied this request in LFG." };
          };
      const onUserInputRequest: NonNullable<SessionConfig["onUserInputRequest"]> = async (request) => {
        const choices = request.choices ?? [];
        if (!choices.length) return { answer: "", wasFreeform: true };
        const selected = await sink.ask(
          request.question,
          choices.map((choice) => ({ label: choice })),
          "Copilot question",
        );
        return { answer: selected == null ? "" : choices[selected] ?? "", wasFreeform: false };
      };
      const config = {
        model,
        workingDirectory: cwd,
        onPermissionRequest,
        onUserInputRequest,
        ...omgMcpServers(key),
        ...(thinkingLevel ? { reasoningEffort: thinkingLevel as "low" | "medium" | "high" | "xhigh" | "max" } : {}),
      };
      const session = resume
        ? await client.resumeSession(resume, config)
        : await client.createSession({ ...config, sessionId: key });
      return {
        nativeSessionId: session.sessionId,
        async runTurn(prompt) {
          let draft = "";
          let thought = "";
          const unsubscribe = session.on((event: SessionEvent) => {
            if (event.agentId) return;
            switch (event.type) {
              case "assistant.message_delta":
                draft += event.data.deltaContent;
                sink.draft(draft);
                break;
              case "assistant.reasoning_delta":
                thought += event.data.deltaContent;
                sink.thinking(thought);
                break;
              case "tool.execution_start":
                sink.toolStart(event.data.toolCallId, event.data.toolName, event.data.arguments);
                break;
              case "tool.execution_complete":
                sink.toolEnd(
                  event.data.toolCallId,
                  event.data.toolDescription?.name ?? "tool",
                  event.data.error?.message ?? event.data.result?.detailedContent ?? event.data.result?.content,
                  !event.data.success,
                );
                break;
              default:
                break;
            }
          });
          try {
            const result = await session.sendAndWait({ prompt }, 10 * 60_000);
            return { text: result?.data.content ?? draft, thinking: thought };
          } finally {
            unsubscribe();
          }
        },
        interrupt: () => session.abort(),
        async close() {
          await session.disconnect();
          await client.stop();
        },
        setModel: (next) => session.setModel(next),
      };
    },
  });
}

if (import.meta.main) {
  cmdCopilotSdkSession(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
