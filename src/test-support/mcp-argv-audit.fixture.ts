// Isolated process: intercept the real SDK/adapter spawn boundary without
// modifying modules in the test runner or starting paid model requests.
import { mock } from "bun:test";
import childProcess from "node:child_process";
import { writeFileSync, readFileSync, statSync } from "node:fs";
import { sessionToken } from "../policy/session-token.ts";

const backend = process.argv[2]!;
const token = sessionToken("argv-audit");
function capture(command: string, args: string[] = [], options: { env?: Record<string, string | undefined> } = {}): never {
  const argv = [command, ...args];
  const text = argv.join(" ");
  const file = args[args.indexOf("--mcp-config") + 1];
  const hasFile = args.includes("--mcp-config") && !!file && !file.startsWith("{");
  const evidence = {
    backend,
    captured: true,
    noToken: !text.includes(token),
    noSecretShape: !/(?:Bearer\s|sk-ant-|(?<!env_)http_headers.*=)/.test(text),
    privateFile: hasFile ? (statSync(file!).mode & 0o777) === 0o600 : false,
    fileHasToken: hasFile ? readFileSync(file!, "utf8").includes(token) : false,
    environmentHasToken: Object.values(options.env ?? {}).some((value) => value?.includes(token)),
  };
  writeFileSync(process.env.AUDIT_CAPTURE!, JSON.stringify(evidence));
  process.exit(0);
}
childProcess.spawn = capture as unknown as typeof childProcess.spawn;
mock.module("child_process", () => ({ ...childProcess, spawn: capture }));
mock.module("node:child_process", () => ({ ...childProcess, spawn: capture }));
const args = ["--key", "argv-audit", "--session", "argv-audit", "--cwd", process.cwd(), "--", "test"];
const noop = () => {};
const drivers: Record<string, [string, string]> = {
  pi: ["pi-session", "cmdPiSession"],
  jcode: ["jcode-sdk-session", "cmdJcodeSdkSession"],
  aisdk: ["aisdk-session", "cmdAisdkSession"],
  "codex-aisdk": ["codex-aisdk-session", "cmdCodexAisdkSession"],
  opencode: ["opencode-aisdk-session", "cmdOpencodeAisdkSession"],
  cursor: ["cursor-acp-session", "cmdCursorAcpSession"],
  grok: ["grok-acp-session", "cmdGrokAcpSession"],
  fx: ["fx-acp-session", "cmdFxAcpSession"],
  copilot: ["copilot-sdk-session", "cmdCopilotSdkSession"],
  muse: ["muse-msp-session", "cmdMuseMspSession"],
  deepseek: ["deepseek-acp-session", "cmdDeepseekAcpSession"],
  devin: ["devin-acp-session", "cmdDevinAcpSession"],
};
if (backend === "claude-report") {
  const { pipeToClaudeAiSdk } = await import("../agents/backends/claude-ai-sdk.ts");
  await pipeToClaudeAiSdk("test", noop);
} else if (backend === "codex-report") {
  const { pipeToCodexAiSdk } = await import("../agents/backends/codex-aisdk-session.ts");
  await pipeToCodexAiSdk("test", noop);
} else if (backend === "claude-cli" || backend === "codex-cli") {
  const tmux = await import("../tmux.ts");
  const original = Bun.spawnSync;
  Bun.spawnSync = ((argv: string[], ...rest: unknown[]) => {
    if (argv[0] === "tmux" && argv.includes("new-session")) capture(argv[0]!, argv.slice(1));
    return (original as Function)(argv, ...rest);
  }) as typeof Bun.spawnSync;
  const launch = backend === "claude-cli" ? tmux.spawnManagedSession : tmux.spawnManagedCodexSession;
  launch({ name: "argv-audit", cwd: process.cwd(), omgSessionId: "argv-audit", prompt: "test" });
} else {
  const [file, method] = drivers[backend]!;
  const driver = await import(`../agents/backends/${file}.ts`);
  await driver[method](args);
}
throw new Error("No child launch captured");
