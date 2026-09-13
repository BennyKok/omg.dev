import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGeneratedSessionTitle, generateSessionTitle, SESSION_TITLE_MODEL } from "./session-auto-title.ts";

describe("automatic session titles", () => {
  test("uses the cheapest managed model through the hosted sandbox proxy", async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const title = await generateSessionTitle("Please fix the mobile session list overflow", {
      env: { OMG_AI_URL: "http://169.254.0.1:9090" },
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ choices: [{ message: { content: "Fix Mobile Session Overflow" } }] });
      },
    });

    const request = requests[0]!;
    expect(title).toBe("Fix Mobile Session Overflow");
    expect(request.url).toBe("http://169.254.0.1:9090/openai/v1/chat/completions");
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.body.model).toBe(SESSION_TITLE_MODEL);
  });

  test("uses the signed-in CLI route outside a sandbox", async () => {
    const root = mkdtempSync(join(tmpdir(), "omg-auto-title-"));
    const credentialPath = join(root, "credentials.json");
    await Bun.write(credentialPath, JSON.stringify({ token: "secret", kind: "api-key" }));
    const requests: Array<{ url: string; headers: Headers }> = [];
    try {
      await generateSessionTitle("Diagnose the launch failure", {
        env: {},
        credentialPath,
        cloudBaseUrl: "https://backend.example",
        fetch: async (input, init) => {
          requests.push({ url: String(input), headers: new Headers(init?.headers) });
          return Response.json({ choices: [{ message: { content: "Diagnose Launch Failure" } }] });
        },
      });
      const request = requests[0]!;
      expect(request.url).toBe("https://backend.example/api/cli/llm/v1/chat/completions");
      expect(request.headers.get("authorization")).toBe("Bearer secret");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps failures harmless and cleans model formatting", async () => {
    expect(cleanGeneratedSessionTitle('<think>draft</think> Title: "Repair session titles."')).toBe("Repair session titles");
    expect(await generateSessionTitle("Keep the fallback", {
      env: { OMG_AI_URL: "http://proxy" },
      fetch: async () => new Response("no", { status: 503 }),
    })).toBeNull();
  });
});
