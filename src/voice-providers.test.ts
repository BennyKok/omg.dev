import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifySttProviderError,
  providerErrorResponse,
  writeEnvValue,
} from "./voice-providers.ts";

let dir = "";

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
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

describe("classifySttProviderError", () => {
  test("maps authentication failures without returning provider text", () => {
    expect(classifySttProviderError("openai", 401, "invalid_api_key")).toEqual({
      code: "invalid_api_key",
      provider: "openai",
      retryable: false,
      upstreamStatus: 401,
      message: "OpenAI rejected the API key. Add a valid key in Voice settings.",
    });
  });

  test("separates exhausted credit from a temporary rate limit", () => {
    expect(classifySttProviderError("openai", 429, "credit_balance_exhausted").code).toBe(
      "credit_balance_exhausted",
    );
    expect(classifySttProviderError("openai", 429, "insufficient_quota").code).toBe(
      "credit_balance_exhausted",
    );
    expect(classifySttProviderError("openai", 429).code).toBe("rate_limited");
  });

  test("keeps unknown provider failures generic", () => {
    const failure = classifySttProviderError("elevenlabs", 418, "secret-provider-detail");
    expect(failure.code).toBe("transcription_failed");
    expect(failure.retryable).toBe(false);
    expect(failure.message).not.toContain("secret-provider-detail");
  });

  test("returns the stable code without leaking the upstream response", async () => {
    const response = await providerErrorResponse(
      "openai",
      new Response(
        JSON.stringify({
          error: {
            code: "credit_balance_exhausted",
            message: "private upstream account detail",
          },
        }),
        { status: 429 },
      ),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(502);
    expect(body.code).toBe("credit_balance_exhausted");
    expect(body.provider).toBe("openai");
    expect(JSON.stringify(body)).not.toContain("private upstream account detail");
  });
});
