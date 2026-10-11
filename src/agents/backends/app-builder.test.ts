import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_BUILDER_PRESET, builderReviewPacket, captureBuilderDesign, reviewBuilderCode, reviewBuilderDesign, parseBuilderVerdict, runAppBuilder, validateBuilderPreset } from "./app-builder";

test("preset is opt-in and restricted to OMG Agent", () => {
  expect(validateBuilderPreset(undefined, "omg")).toBeUndefined();
  expect(validateBuilderPreset(APP_BUILDER_PRESET, "omg")).toBe(APP_BUILDER_PRESET);
  expect(() => validateBuilderPreset(APP_BUILDER_PRESET, "claude")).toThrow("OMG Agent only");
  expect(() => validateBuilderPreset("unknown", "omg")).toThrow("Unknown");
});


const verdict = (passed = true) => ({ text: JSON.stringify({ passed, issues: passed ? [] : ["Fix mascot"] }), passed, issues: passed ? [] : ["Fix mascot"], cost: .004, tokens: {}, sessionId: "review" });
const evidence = { parts: [], screenshotPath: "/candidate.jpg", brief: "teal blob holding a mug" };

test("completion requires both reviewers to pass on the same revision", async () => {
  const phases: string[] = []; let builds = 0;
  await runAppBuilder({ prompt: "build", build: async () => { builds++; return true; }, succeeded: Boolean,
    packet: async () => "source", review: async () => verdict(), evidence: async () => evidence,
    designReview: async () => verdict(), stopped: () => false, phase: p => phases.push(p) });
  expect(builds).toBe(1); expect(phases).toEqual(["build", "review", "design-review", "complete"]);
});

test("a design mismatch triggers repair and both reviews on fresh evidence", async () => {
  let builds = 0, codes = 0, designs = 0, screenshots = 0; const prompts: string[] = [];
  await runAppBuilder({ prompt: "build", build: async p => { builds++; prompts.push(p); return true; }, succeeded: Boolean,
    packet: async () => "source", review: async () => { codes++; return verdict(); },
    evidence: async () => { screenshots++; return evidence; }, designReview: async () => verdict(++designs > 1),
    stopped: () => false, phase: () => {} });
  expect(builds).toBe(2); expect(codes).toBe(2); expect(screenshots).toBe(2); expect(designs).toBe(2);
  expect(prompts[1]).toContain("Fix mascot");
});

test("passing design cannot hide a code failure after repair", async () => {
  let codes = 0, designs = 0, builds = 0; const phases: string[] = [];
  await expect(runAppBuilder({ prompt: "build", build: async () => { builds++; return true; }, succeeded: Boolean,
    packet: async () => "source", review: async () => verdict(++codes === 1), evidence: async () => evidence,
    designReview: async () => verdict(++designs > 1), stopped: () => false, phase: p => phases.push(p) })).rejects.toThrow("not both passed");
  expect(builds).toBe(2); expect(phases.at(-1)).toBe("failed"); expect(phases).not.toContain("complete");
});

test("stop during design review prevents repairs", async () => {
  let stopped = false, builds = 0;
  await runAppBuilder({ prompt: "build", build: async () => { builds++; return true; }, succeeded: Boolean,
    packet: async () => "source", review: async () => verdict(), evidence: async () => evidence,
    designReview: async () => { stopped = true; return verdict(false); }, stopped: () => stopped, phase: () => {} });
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
    prompt: async (opts) => { body = opts.body; return { data: { info: { cost: .003, tokens: { output: 100 } }, parts: [{ type: "text", text: '{"passed":false,"issues":["Fix race"]}' }] } }; },
    abort: async () => ({}),
  } }, "/project", "source", new AbortController().signal);
  expect(body.agent).toBe("omg-code-review"); expect(body.model.modelID).toBe("apex"); expect(result.sessionId).toBe("separate-review");
});


test("invalid and inconsistent reviewer verdicts are rejected", () => {
  expect(() => parseBuilderVerdict("all good")).toThrow("invalid");
  expect(() => parseBuilderVerdict('{"passed":true,"issues":["bad mascot"]}')).toThrow("inconsistent");
  expect(parseBuilderVerdict('```json\n{"passed":true,"issues":[]}\n```').passed).toBe(true);
});

test("design review forwards images to a vision model in an isolated session", async () => {
  let body: any;
  const result = await reviewBuilderDesign({ session: {
    create: async () => ({ data: { id: "design" } }), prompt: async opts => { body = opts.body;
      return { data: { info: {}, parts: [{ type: "text", text: '{"passed":false,"issues":["Missing mug"]}' }] } }; }, abort: async () => ({})
  } }, "/project", { ...evidence, parts: [{ type: "file", mime: "image/jpeg", url: "data:image/jpeg;base64,abc", filename: "rendered-app.jpg" }] }, new AbortController().signal);
  expect(body.model.modelID).toBe("openai/gpt-6-luna"); expect(body.parts[1].type).toBe("file"); expect(result.passed).toBe(false);
});


test("capture uses a rendered local preview and blocks external URLs and output symlinks", async () => {
  const cache = join(homedir(), ".cache/lfg/tmp"); mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "builder-capture-test-"));
  const outside = mkdtempSync(join(cache, "builder-capture-outside-"));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("<html><body><h1>Rendered app preview</h1></body></html>", { headers: { "Content-Type": "text/html" } }) });
  const manifest = join(dir, ".omg/app-builder-preview.json"); mkdirSync(join(dir, ".omg"));
  const signal = () => AbortSignal.timeout(30_000);
  try {
    writeFileSync(manifest, JSON.stringify({ url: "https://example.com" }));
    await expect(captureBuilderDesign(dir, "Simple app", signal())).rejects.toThrow("local web preview");
    writeFileSync(manifest, JSON.stringify({ url: `http://127.0.0.1:${server.port}` }));
    const captured = await captureBuilderDesign(dir, "Simple app", signal());
    expect(captured.parts).toHaveLength(1); expect(captured.parts[0].filename).toBe("rendered-app.jpg");
    expect((await Bun.file(captured.screenshotPath).bytes()).length).toBeGreaterThan(1000);
    const image = new (Bun as any).WebView({ width: 390, height: 844 });
    try {
      await image.navigate("about:blank");
      const size = await image.evaluate(`(async()=>{const img=new Image();img.src=${JSON.stringify(captured.parts[0].url)};await img.decode();return [img.naturalWidth,img.naturalHeight];})()`);
      expect(size).toEqual([390, 844]);
    } finally { image.close(); }
    rmSync(join(dir, ".omg/app-builder-review"), { recursive: true });
    symlinkSync(outside, join(dir, ".omg/app-builder-review"));
    await expect(captureBuilderDesign(dir, "Simple app", signal())).rejects.toThrow("outside the project");
  } finally { server.stop(); rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("screenshot capture failure blocks completion and repair", async () => {
  let builds = 0; const phases: string[] = [];
  await expect(runAppBuilder({ prompt: "build", build: async () => { builds++; return true; }, succeeded: Boolean,
    packet: async () => "source", review: async () => verdict(), evidence: async () => { throw Error("preview unavailable"); },
    designReview: async () => verdict(), stopped: () => false, phase: p => phases.push(p) })).rejects.toThrow("preview unavailable");
  expect(builds).toBe(1); expect(phases.at(-1)).toBe("failed"); expect(phases).not.toContain("complete");
});


test("review failure reports status without exposing provider response headers", async () => {
  await expect(reviewBuilderCode({ session: {
    create: async () => ({ data: { id: "error-review" } }),
    prompt: async () => ({ data: { info: { error: { name: "APIError", data: { statusCode: 401, responseHeaders: { Authorization: "PRIVATE" } } } } } }),
    abort: async () => ({})
  } }, "/project", "source", new AbortController().signal)).rejects.toThrow("Reviewer failed: APIError (HTTP 401)");
});
