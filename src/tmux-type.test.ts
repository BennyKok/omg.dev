// tmuxType types a message into a pane with `tmux send-keys -l <text>`. `-l`
// makes tmux send the keys literally, but it does not end option parsing.
// tmux parses its flags like getopt: any argument that starts with "-" (and is
// not exactly "-") is read as more flags until "--" or the first operand. So a
// message such as "- [ ] fix the parser" or "--force was needed" reached tmux
// as flags. tmux rejected it ("invalid flag", "unknown flag"), nothing was
// typed, and the send failed. "--" on its own was swallowed as the terminator
// and nothing was typed at all. "-R" was worse: it is a real send-keys flag,
// so tmux reset the pane's terminal state instead of typing it.
//
// These tests swap in a fake tmux that records its argv and check that, under
// tmux's own parsing rule, the text is always the one operand.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tmuxType } from "./tmux.ts";

// tmux's args_parse() (arguments.c): flags are read while an argument starts
// with "-" and has more after it; "--" ends them; the rest are operands.
// Returns null where tmux fails with "invalid flag" / "unknown flag".
const SEND_KEYS_FLAGS = "c:FHKlMN:Rt:X";
function sendKeysOperands(args: string[]): string[] | null {
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (!arg.startsWith("-") || arg.length === 1) break;
    i++;
    if (arg === "--") break;
    for (let j = 1; j < arg.length; j++) {
      const flag = arg[j];
      if (!/[A-Za-z0-9]/.test(flag)) return null;
      const at = SEND_KEYS_FLAGS.indexOf(flag);
      if (at < 0) return null;
      if (SEND_KEYS_FLAGS[at + 1] === ":") {
        if (j === arg.length - 1) i++; // value is the next argument
        break;
      }
    }
  }
  return args.slice(i);
}

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tmux-type-"));
  log = join(dir, "argv");
  const fake = join(dir, "tmux");
  writeFileSync(fake, `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done > "${log}"\n`);
  chmodSync(fake, 0o755);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Bun resolves "tmux" against the PATH it started with, so call tmuxType from a
// child whose PATH finds the fake first.
function typed(text: string): string[] | null {
  const script = `import { tmuxType } from ${JSON.stringify(join(import.meta.dir, "tmux.ts"))};
process.exit(tmuxType("pane", process.argv.at(-1)) ? 0 : 1);`;
  const child = Bun.spawnSync([process.execPath, "-e", script, "--", text], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  });
  expect(child.exitCode).toBe(0);
  const argv = readFileSync(log, "utf8").split("\0").slice(0, -1);
  expect(argv[0]).toBe("send-keys");
  return sendKeysOperands(argv.slice(1));
}

describe("tmuxType", () => {
  test.each([
    "- [ ] fix the parser",
    "--force was needed",
    "-v",
    "-R",
    "--",
    "-",
    "plain text",
  ])("sends %p as keys, not flags", (text) => {
    expect(typed(text)).toEqual([text]);
  });
});
