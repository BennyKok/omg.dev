import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_BUILDER_PRESET, builderReviewPacket, reviewBuilderCode, runAppBuilder, validateBuilderPreset } from "./app-builder";

test("preset is opt-in and restricted to OMG Agent", () => {
  expect(validateBuilderPreset(undefined, "omg")).toBeUndefined();
  expect(validateBuilderPreset(APP_BUILDER_PRESET, "omg")).toBe(APP_BUILDER_PRESET);
  expect(() => validateBuilderPreset(APP_BUILDER_PRESET, "claude")).toThrow("OMG Agent only");
  expect(() => validateBuilderPreset("unknown", "omg")).toThrow("Unknown");
});

test("one isolated review follows build, then the same executor fixes", async () => {
  const phases: string[] = []; const prompts: string[] = []; let reviews = 0;
  const result = await runAppBuilder({
    prompt: "Build tasks", build: async (prompt) => { prompts.push(prompt); return true; },
    succeeded: Boolean, packet: async () => "source", stopped: () => false,
    review: async () => { reviews++; return { text: "Serialize mutations", cost: .004, tokens: {}, sessionId: "review" }; },
    phase: (phase) => phases.push(phase),
  });
  expect(result).toBe(true); expect(reviews).toBe(1); expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Serialize mutations");
  expect(phases).toEqual(["build", "review", "fix", "complete"]);
});

test("empty advice fails without invoking a fix or claiming completion", async () => {
  const phases: string[] = []; let builds = 0;
  await expect(runAppBuilder({
    prompt: "build", build: async () => { builds++; return true; }, succeeded: Boolean,
    packet: async () => "source", stopped: () => false,
    review: async () => ({ text: "", cost: .01, tokens: {}, sessionId: "review" }), phase: (p) => phases.push(p),
  })).rejects.toThrow("no advice");
  expect(builds).toBe(1); expect(phases.at(-1)).toBe("failed");
});

test("stop during review prevents the repair call", async () => {
  let stopped = false; let builds = 0;
  await runAppBuilder({ prompt: "build", build: async () => { builds++; return true; }, succeeded: Boolean,
    packet: async () => "source", stopped: () => stopped,
    review: async () => { stopped = true; return { text: "fix", cost: 0, tokens: {}, sessionId: "r" }; }, phase: () => {},
  });
  expect(builds).toBe(1);
});

test("review packet is bounded and excludes ignored files and symlink escapes", async () => {
  const cache = join(homedir(), ".cache/lfg/tmp"); mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "builder-packet-test-"));
  const outside = join(cache, `builder-outside-${crypto.randomUUID()}.ts`);
  const git = (...args: string[]) => { const p = Bun.spawnSync(["git", ...args], { cwd: dir }); if (p.exitCode) throw Error(new TextDecoder().decode(p.stderr)); };
  try {
    git("init"); writeFileSync(join(dir, ".gitignore"), ".env\nignored.ts\n");
    git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "initial");
    writeFileSync(join(dir, "tasks.ts"), "export const tasks = [];\n".repeat(500));
    writeFileSync(join(dir, "focus.tsx"), "// body\n".repeat(400) + "function resetIfDone() { return 0; }\nconst styles = StyleSheet.create({ omittedStyle: true });");
    writeFileSync(join(dir, ".env"), "PRIVATE_VALUE"); writeFileSync(join(dir, "ignored.ts"), "PRIVATE_VALUE");
    writeFileSync(join(dir, "auth.ts"), "PRIVATE_VALUE"); writeFileSync(outside, "PRIVATE_VALUE"); symlinkSync(outside, join(dir, "escape.ts"));
    const packet = await builderReviewPacket(dir, "HEAD");
    expect(packet.length).toBeLessThanOrEqual(18000); expect(packet).toContain("tasks.ts"); expect(packet).not.toContain("PRIVATE_VALUE");
    expect(packet).toContain("function resetIfDone()"); expect(packet).not.toContain("omittedStyle");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { force: true }); }
});

test("review uses a separate OpenCode session and configured review agent", async () => {
  let body: any;
  const result = await reviewBuilderCode({ session: {
    create: async () => ({ data: { id: "separate-review" } }),
    prompt: async (opts) => { body = opts.body; return { data: { info: { cost: .003, tokens: { output: 100 } }, parts: [{ type: "text", text: "Fix race" }] } }; },
    abort: async () => ({}),
  } }, "/project", "source", new AbortController().signal);
  expect(body.agent).toBe("omg-code-review"); expect(body.model.modelID).toBe("apex"); expect(result.sessionId).toBe("separate-review");
});
