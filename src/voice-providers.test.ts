import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pickStt, writeEnvValue } from "./voice-providers.ts";

let dir = "";

const VOICE_ENV_VARS = ["OMG_MEDIA_URL", "ELEVENLABS_API_KEY", "OPENAI_API_KEY"] as const;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
  for (const key of VOICE_ENV_VARS) delete process.env[key];
});

describe("pickStt (batch STT provider selection)", () => {
  // Regression coverage for a real bug: the batch fallback used to accept any
  // provider with a `transcribe` method, but every provider defines one —
  // including the hosted omg relay, whose `transcribe` unconditionally 503s
  // because the relay is realtime-only. `firstAvailable((c) => !!c.transcribe)`
  // could therefore never see past the relay to a provider that could
  // actually do the job.
  test("prefers a provider that can actually transcribe over the realtime-only relay", () => {
    process.env.OMG_MEDIA_URL = "https://relay.example/media";
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.ELEVENLABS_API_KEY;

    // Asking for "omg" explicitly (e.g. a saved setting from before OpenAI was
    // configured) must not shadow a provider that can genuinely do the job.
    const picked = pickStt("omg");

    expect(picked.id).toBe("openai");
  });

  // When the relay really is the only thing configured, it should still be
  // the pick — its own `transcribe()` gives the specific "realtime-only"
  // reason (covered in test/omg-relay-stt.test.ts), which is more useful
  // than a generic "not configured" from a provider nobody chose.
  test("still returns the relay when nothing else can do batch either", () => {
    process.env.OMG_MEDIA_URL = "https://relay.example/media";
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const picked = pickStt("omg");

    expect(picked.id).toBe("omg");
  });
});

describe("writeEnvValue", () => {
  test("replaces an existing value while preserving surrounding lines", async () => {
    dir = await mkdtemp(join(tmpdir(), "lfg-voice-env-"));
    const file = join(dir, ".env");
    await writeFile(file, "# voice\nELEVENLABS_API_KEY=old\nOPENAI_API_KEY=keep\n", { mode: 0o640 });

    await writeEnvValue(file, "ELEVENLABS_API_KEY", "new_key-123");

    expect(await readFile(file, "utf8")).toBe(
      "# voice\nELEVENLABS_API_KEY=new_key-123\nOPENAI_API_KEY=keep\n",
    );
    expect((await stat(file)).mode & 0o777).toBe(0o640);
  });

  test("appends a missing value and creates new files private", async () => {
    dir = await mkdtemp(join(tmpdir(), "lfg-voice-env-"));
    const existing = join(dir, "existing.env");
    await writeFile(existing, "OTHER=value");
    await writeEnvValue(existing, "ELEVENLABS_API_KEY", "key");
    expect(await readFile(existing, "utf8")).toBe("OTHER=value\nELEVENLABS_API_KEY=key");

    const created = join(dir, "created.env");
    await writeEnvValue(created, "ELEVENLABS_API_KEY", "key");
    expect(await readFile(created, "utf8")).toBe("ELEVENLABS_API_KEY=key");
    expect((await stat(created)).mode & 0o777).toBe(0o600);
  });
});
