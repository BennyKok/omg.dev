// End to end for the owner's standing instructions: the stored setting has to
// reach the argv a real adapter launches with.
//
// The unit tests either side of this cover the store (settings-custom-
// instructions.test.ts) and the envelope text (omg-capabilities.test.ts). The
// link between them is the part that silently breaks — an adapter added later
// that calls withOmgRuntimeContract directly reads no setting at all and fails
// exactly nowhere. These assert the prompt that lands in argv.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";
import { managedAisdkSessionArgv, managedCodexAisdkSessionArgv } from "./tmux.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-launch-instructions-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

afterEach(async () => {
  await settings.setGlobalSettings({ customInstructions: "" });
});

const RULES = "Always run the tests before you say you are done.";

/** The prompt an adapter puts after `--`, which is the agent's first message. */
function promptArg(argv: string[]): string | undefined {
  const at = argv.lastIndexOf("--");
  return at < 0 ? undefined : argv[at + 1];
}

function aisdkArgv() {
  return managedAisdkSessionArgv({
    name: "lfg-instructions-test",
    cwd: "/tmp/lfg-instructions-test",
    model: "opus",
    sessionId: "session-key",
    prompt: "Fix the mobile navigation",
  });
}

describe("standing instructions reach a launch", () => {
  test("an unset setting leaves the prompt exactly as it is today", () => {
    const prompt = promptArg(aisdkArgv())!;
    expect(prompt).toContain("Fix the mobile navigation");
    expect(prompt).not.toContain("=== USER STANDING INSTRUCTIONS ===");
  });

  test("a saved setting is carried into the claude adapter's argv", async () => {
    await settings.setGlobalSettings({ customInstructions: RULES });
    const prompt = promptArg(aisdkArgv())!;
    expect(prompt).toContain(RULES);
    expect(prompt).toContain("Fix the mobile navigation");
  });

  test("and into a second adapter, so this is not wired per agent", async () => {
    await settings.setGlobalSettings({ customInstructions: RULES });
    const prompt = promptArg(
      managedCodexAisdkSessionArgv({
        name: "lfg-instructions-codex",
        cwd: "/tmp/lfg-instructions-test",
        model: "gpt-5",
        key: "session-key",
        prompt: "Fix the mobile navigation",
      }),
    )!;
    expect(prompt).toContain(RULES);
  });

  test("is read per launch, so an edit applies to the next session with no restart", async () => {
    await settings.setGlobalSettings({ customInstructions: RULES });
    expect(promptArg(aisdkArgv())!).toContain(RULES);

    await settings.setGlobalSettings({ customInstructions: "Ask before you push." });
    const after = promptArg(aisdkArgv())!;
    expect(after).toContain("Ask before you push.");
    expect(after).not.toContain(RULES);
  });

  test("a launch with no prompt stays empty rather than sending the rules alone", async () => {
    await settings.setGlobalSettings({ customInstructions: RULES });
    const argv = managedAisdkSessionArgv({
      name: "lfg-instructions-empty",
      cwd: "/tmp/lfg-instructions-test",
      model: "opus",
      sessionId: "session-key",
    });
    expect(argv).not.toContain("--");
  });
});
