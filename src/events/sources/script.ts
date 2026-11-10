// The general source: any shell script. This is how an agent watches a system
// that has no built-in source. The script prints what is there NOW; the bus
// finds what is new.
//
// Output rules:
//   - Every non-empty line is a JSON object with a string "key"
//       -> one event per line. Optional fields: topic, title, url, data.
//          {"key":"comment:123","title":"New comment","url":"https://...","data":{...}}
//   - Anything else, non-empty
//       -> one event for the whole output, keyed by its hash. So a script can
//          print a status, and the hook fires when the status changes.
//   - Empty output -> no events.
//   - Non-zero exit, timeout or too much output -> the check fails.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { runBounded, SCRIPT_COMMAND_MAX_CHARS } from "../process.ts";
import type { NewEvent, Source } from "../types.ts";

type ScriptSource = { kind: "script"; command: string; cwd?: string };

export function parseScriptOutput(stdout: string): NewEvent[] {
  const text = stdout.trim();
  if (!text) return [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows: NewEvent[] = [];
  for (const line of lines) {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      obj = null;
    }
    const o = obj as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || Array.isArray(o) || typeof o.key !== "string" || !o.key) {
      return [
        {
          key: `sha256:${createHash("sha256").update(text).digest("hex")}`,
          topic: "script",
          title: lines[0].slice(0, 200),
          data: text,
        },
      ];
    }
    rows.push({
      key: o.key.slice(0, 300),
      topic: typeof o.topic === "string" && o.topic ? o.topic.slice(0, 80) : "script",
      title: typeof o.title === "string" ? o.title.slice(0, 200) : undefined,
      url: typeof o.url === "string" && /^https?:\/\//.test(o.url) ? o.url : undefined,
      data: o.data ?? o,
    });
  }
  return rows;
}

export const scriptSource: Source<ScriptSource> = {
  kind: "script",
  validate(input) {
    const command = typeof input.command === "string" ? input.command.trim() : "";
    if (!command) return { ok: false, error: "script source needs a command" };
    if (command.length > SCRIPT_COMMAND_MAX_CHARS)
      return { ok: false, error: `command is longer than ${SCRIPT_COMMAND_MAX_CHARS} characters` };
    const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined;
    if (cwd && (!isAbsolute(cwd) || !existsSync(cwd))) return { ok: false, error: `cwd "${cwd}" is not an existing absolute path` };
    return { ok: true, config: { kind: "script", command, ...(cwd ? { cwd } : {}) } };
  },
  async collect(config, ctx) {
    const { stdout } = await runBounded(["bash", "-c", config.command], {
      hookId: ctx.hookId,
      cwd: config.cwd ?? homedir(),
    });
    return parseScriptOutput(stdout);
  },
};
