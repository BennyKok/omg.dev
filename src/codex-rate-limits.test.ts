import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumeCodexRateLimitResetCredit,
  mapCodexRateLimitResult,
  readCodexRateLimits,
} from "./codex-rate-limits.ts";

let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function fakeAppServer(result: unknown): { command: string; log: string } {
  root = mkdtempSync(join(tmpdir(), "omg-codex-limits-"));
  const command = join(root, "codex");
  const log = join(root, "requests.log");
  const response = JSON.stringify({ id: 2, result }).replaceAll("'", "'\\''");
  writeFileSync(command, `#!/usr/bin/env bash
while IFS= read -r line; do
  printf '%s\\n' "$line" >> "$OMG_TEST_REQUEST_LOG"
  if [[ "$line" == *'"id":1'* ]]; then
    printf '%s\\n' '{"id":1,"result":{}}'
  elif [[ "$line" == *'"id":2'* ]]; then
    printf '%s\\n' '${response}'
  fi
done
`);
  chmodSync(command, 0o755);
  return { command, log };
}

const response = {
  rateLimits: {
    limitId: "codex",
    planType: "pro",
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_781_654_400 },
    secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1_782_086_400 },
  },
  rateLimitResetCredits: {
    availableCount: 2,
    credits: [
      {
        id: "opaque-do-not-expose",
        resetType: "codexRateLimits",
        status: "available",
        grantedAt: 1_781_654_400,
        expiresAt: 1_784_246_400,
        title: "Rate-limit reset",
        description: "Reset an eligible Codex rate-limit window.",
      },
    ],
  },
};

describe("Codex rate-limit app-server client", () => {
  test("maps windows and the credit id required for an explicit redemption", () => {
    const mapped = mapCodexRateLimitResult(response);
    expect(mapped.rateLimits?.primary?.usedPercent).toBe(25);
    expect(mapped.rateLimitResetCredits).toEqual({
      availableCount: 2,
      credits: [{
        id: "opaque-do-not-expose",
        resetType: "codexRateLimits",
        status: "available",
        grantedAt: 1_781_654_400,
        expiresAt: 1_784_246_400,
        title: "Rate-limit reset",
        description: "Reset an eligible Codex rate-limit window.",
      }],
    });
    expect(mapped.rateLimitResetCredits?.credits?.[0]?.id).toBe("opaque-do-not-expose");
  });

  test("keeps count-only responses distinct from an empty detailed inventory", () => {
    expect(mapCodexRateLimitResult({
      rateLimitResetCredits: { availableCount: 3, credits: null },
    }).rateLimitResetCredits).toEqual({ availableCount: 3, credits: null });
    expect(mapCodexRateLimitResult({
      rateLimitResetCredits: { availableCount: 0, credits: [] },
    }).rateLimitResetCredits).toEqual({ availableCount: 0, credits: [] });
  });

  test("performs only the initialize handshake and the read request", async () => {
    const fake = fakeAppServer(response);
    const snapshot = await readCodexRateLimits({
      command: fake.command,
      env: { ...process.env, OMG_TEST_REQUEST_LOG: fake.log },
      timeoutMs: 2_000,
    });
    expect(snapshot.rateLimitResetCredits?.availableCount).toBe(2);
    const methods = readFileSync(fake.log, "utf8").trim().split("\n")
      .map((line) => JSON.parse(line).method);
    expect(methods).toEqual([
      "initialize",
      "initialized",
      "account/rateLimits/read",
    ]);
  });

  test("sends one selected credit with an idempotency key", async () => {
    const fake = fakeAppServer({ outcome: "reset" });
    const outcome = await consumeCodexRateLimitResetCredit(
      { creditId: "credit-1", idempotencyKey: "attempt-1" },
      {
        command: fake.command,
        env: { ...process.env, OMG_TEST_REQUEST_LOG: fake.log },
        timeoutMs: 2_000,
      },
    );
    expect(outcome).toBe("reset");
    const requests = readFileSync(fake.log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(requests.map((request) => request.method)).toEqual([
      "initialize",
      "initialized",
      "account/rateLimitResetCredit/consume",
    ]);
    expect(requests[2].params).toEqual({ creditId: "credit-1", idempotencyKey: "attempt-1" });
  });

  test("fails cleanly when the app-server does not answer", async () => {
    const fake = fakeAppServer(response);
    writeFileSync(fake.command, "#!/usr/bin/env bash\ncat >/dev/null\n");
    chmodSync(fake.command, 0o755);
    await expect(readCodexRateLimits({ command: fake.command, timeoutMs: 30 }))
      .rejects.toThrow("timed out");
  });
});
