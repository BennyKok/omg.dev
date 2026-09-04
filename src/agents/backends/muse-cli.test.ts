import { describe, expect, test } from "bun:test";
import { museExecArgv, parseMuseExecOutput } from "./muse-cli.ts";

// Records captured from `muse exec --json --provider echo` against muse 1.0.2.
const ECHO_RUN = [
  '{"payload_type":"runtime.command.accepted","payload":{"kind":"command_accepted"}}',
  '{"payload_type":"run.lifecycle.started","payload":{"kind":"run_started","prompt":"test"}}',
  '{"payload_type":"run.output.delta","payload":{"kind":"run_output_delta","text":"echo: "}}',
  '{"payload_type":"run.output.delta","payload":{"kind":"run_output_delta","text":"test"}}',
  '{"payload_type":"run.terminal.completed","payload":{"kind":"run_terminal","reason":null,"terminal":"completed","text":"echo: test"}}',
  "",
].join("\n");

describe("parseMuseExecOutput", () => {
  test("takes the terminal record's text", () => {
    expect(parseMuseExecOutput(ECHO_RUN)).toEqual({ text: "echo: test", terminal: "completed", reason: null });
  });

  test("falls back to the streamed deltas when the terminal record carries no text", () => {
    const stream = ECHO_RUN.replace(',"text":"echo: test"', "");
    expect(parseMuseExecOutput(stream)).toEqual({ text: "echo: test", terminal: "completed", reason: null });
  });

  test("surfaces a failed run with its reason and skips non-JSON noise", () => {
    const out = 'muse: workspace root: /tmp\n{"payload_type":"run.terminal.failed","payload":{"terminal":"failed","reason":"not logged in"}}\n';
    expect(parseMuseExecOutput(out)).toEqual({ text: "", terminal: "failed", reason: "not logged in" });
  });
});

describe("museExecArgv", () => {
  test("read-only runs disable writes, shell and approvals; writable runs use --yolo", () => {
    const ro = museExecArgv({ cwd: "/w", thinkingLevel: "max" }).slice(1);
    expect(ro).toEqual([
      "exec", "--json", "--workspace", "/w", "--user-input-auto-resolve",
      "--disable-approval", "--disable-sandbox", "--disable-write", "--disable-shell",
      "--reasoning-effort", "ultra",
    ]);
    const rw = museExecArgv({ cwd: "/w", model: "auto", writable: true }).slice(1);
    expect(rw).toEqual(["exec", "--json", "--workspace", "/w", "--user-input-auto-resolve", "--yolo"]);
  });

  test("forwards a concrete model and the test provider", () => {
    const argv = museExecArgv({ cwd: "/w", model: "muse-large", provider: "echo" }).slice(1);
    expect(argv).toContain("--model");
    expect(argv[argv.indexOf("--model") + 1]).toBe("muse-large");
    expect(argv.slice(-2)).toEqual(["--provider", "echo"]);
  });
});
