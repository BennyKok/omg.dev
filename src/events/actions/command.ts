// Run a script with the events, with no agent. For a deterministic reaction:
// forward to a mailbox, write a file, call a webhook.
//
// The events reach the script on stdin, one JSON object per line. They are
// never put on the command line, so event text cannot become shell code.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { runBounded, SCRIPT_COMMAND_MAX_CHARS } from "../process.ts";
import type { Action } from "../types.ts";

type CommandAction = { kind: "command"; command: string; cwd?: string };

export const commandAction: Action<CommandAction> = {
  kind: "command",
  validate(input) {
    const command = typeof input.command === "string" ? input.command.trim() : "";
    if (!command) return { ok: false, error: "command action needs a command" };
    if (command.length > SCRIPT_COMMAND_MAX_CHARS)
      return { ok: false, error: `command is longer than ${SCRIPT_COMMAND_MAX_CHARS} characters` };
    const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined;
    if (cwd && (!isAbsolute(cwd) || !existsSync(cwd))) return { ok: false, error: `cwd "${cwd}" is not an existing absolute path` };
    return { ok: true, config: { kind: "command", command, ...(cwd ? { cwd } : {}) } };
  },
  async run(events, config, hook) {
    await runBounded(["bash", "-c", config.command], {
      hookId: hook.id,
      cwd: config.cwd ?? homedir(),
      stdin: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    });
    return `command ran (${events.length})`;
  },
};
