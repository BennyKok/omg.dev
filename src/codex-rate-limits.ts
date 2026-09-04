import { existsSync } from "node:fs";
import { homedir } from "node:os";

export type CodexRateLimitWindow = {
  usedPercent?: number;
  windowDurationMins?: number;
  resetsAt?: number;
};

export type CodexRateLimitBucket = {
  limitId?: string;
  limitName?: string | null;
  planType?: string | null;
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
};

export type CodexRateLimitResetCredit = {
  id: string | null;
  resetType: string | null;
  status: string | null;
  grantedAt: number | null;
  expiresAt: number | null;
  title: string | null;
  description: string | null;
};

export type CodexRateLimitResetCredits = {
  availableCount: number;
  /** null means Codex returned the count but withheld the detail rows. */
  credits: CodexRateLimitResetCredit[] | null;
};

export type CodexRateLimitSnapshot = {
  rateLimits: CodexRateLimitBucket | null;
  rateLimitsByLimitId: Record<string, CodexRateLimitBucket> | null;
  rateLimitResetCredits: CodexRateLimitResetCredits | null;
};

type AppServerResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: unknown };
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapWindow(value: unknown): CodexRateLimitWindow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const usedPercent = finiteNumber(row.usedPercent);
  const windowDurationMins = finiteNumber(row.windowDurationMins);
  const resetsAt = finiteNumber(row.resetsAt);
  return {
    ...(usedPercent != null ? { usedPercent } : {}),
    ...(windowDurationMins != null ? { windowDurationMins } : {}),
    ...(resetsAt != null ? { resetsAt } : {}),
  };
}

function mapBucket(value: unknown): CodexRateLimitBucket | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return {
    ...(typeof row.limitId === "string" ? { limitId: row.limitId } : {}),
    ...(row.limitName === null || typeof row.limitName === "string"
      ? { limitName: row.limitName as string | null }
      : {}),
    ...(row.planType === null || typeof row.planType === "string"
      ? { planType: row.planType as string | null }
      : {}),
    primary: mapWindow(row.primary),
    secondary: mapWindow(row.secondary),
  };
}

function mapResetCredits(value: unknown): CodexRateLimitResetCredits | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rawCount = finiteNumber(row.availableCount);
  if (rawCount == null || rawCount < 0) return null;
  const availableCount = Math.floor(rawCount);
  if (row.credits === null || row.credits === undefined) {
    return { availableCount, credits: null };
  }
  if (!Array.isArray(row.credits)) return { availableCount, credits: null };
  const credits = row.credits
    .filter((credit): credit is Record<string, unknown> => !!credit && typeof credit === "object")
    .map((credit) => ({
      id: nullableString(credit.id),
      resetType: nullableString(credit.resetType),
      status: nullableString(credit.status),
      grantedAt: finiteNumber(credit.grantedAt),
      expiresAt: finiteNumber(credit.expiresAt),
      title: nullableString(credit.title),
      description: nullableString(credit.description),
    }));
  return { availableCount, credits };
}

export function mapCodexRateLimitResult(value: unknown): CodexRateLimitSnapshot {
  const row = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const byId = row.rateLimitsByLimitId && typeof row.rateLimitsByLimitId === "object"
    ? Object.fromEntries(
        Object.entries(row.rateLimitsByLimitId as Record<string, unknown>)
          .map(([id, bucket]) => [id, mapBucket(bucket)] as const)
          .filter((entry): entry is readonly [string, CodexRateLimitBucket] => entry[1] != null),
      )
    : null;
  return {
    rateLimits: mapBucket(row.rateLimits),
    rateLimitsByLimitId: byId,
    rateLimitResetCredits: mapResetCredits(row.rateLimitResetCredits),
  };
}

function codexCommand(): string {
  const onPath = Bun.which("codex");
  if (onPath) return onPath;
  const home = process.env.HOME ?? homedir();
  for (const path of [`${home}/.local/bin/codex`, `${home}/.bun/bin/codex`, "/usr/local/bin/codex"]) {
    if (existsSync(path)) return path;
  }
  return "codex";
}

type CodexAppServerOptions = {
  command?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
};

async function codexAppServerRequest(
  method: string,
  params: unknown,
  options: CodexAppServerOptions,
): Promise<unknown> {
  const proc = Bun.spawn(
    [options.command ?? codexCommand(), "app-server", "--listen", "stdio://"],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: options.env ?? process.env,
    },
  );
  const stdin = proc.stdin;
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let initialized = false;
  let settled = false;

  const send = (message: unknown) => {
    stdin.write(`${JSON.stringify(message)}\n`);
    stdin.flush();
  };

  const timeoutMs = options.timeoutMs ?? 8_000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<unknown>((resolve, reject) => {
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Codex app-server request ${method} timed out`));
      }, timeoutMs);

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      void (async () => {
        try {
          while (!settled) {
            const chunk = await reader.read();
            if (chunk.done) {
              finish(() => reject(new Error("Codex app-server closed before rate limits arrived")));
              return;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              newline = buffer.indexOf("\n");
              if (!line) continue;
              let message: AppServerResponse;
              try {
                message = JSON.parse(line) as AppServerResponse;
              } catch {
                continue;
              }
              if (message.id === 1 && !initialized) {
                if (message.error) {
                  finish(() => reject(new Error(String(message.error?.message ?? "Codex initialization failed"))));
                  return;
                }
                initialized = true;
                send({ method: "initialized", params: {} });
                send({ method, id: 2, ...(params === undefined ? {} : { params }) });
              }
              if (message.id === 2) {
                if (message.error) {
                  const errorMessage = message.error.message;
                  finish(() => reject(new Error(String(errorMessage ?? `Codex request ${method} failed`))));
                } else {
                  finish(() => resolve(message.result));
                }
                return;
              }
            }
          }
        } catch (error) {
          finish(() => reject(error));
        }
      })();

      send({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: { name: "omg_dev_usage", title: "omg.dev Usage", version: "0.1.0" },
        },
      });
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    try {
      stdin.end();
    } catch {
      /* process already closed */
    }
    try {
      proc.kill();
    } catch {
      /* process already closed */
    }
    reader.releaseLock();
    await proc.exited.catch(() => undefined);
  }
}

/** Read current limits and banked reset inventory without changing account state. */
export async function readCodexRateLimits(
  options: CodexAppServerOptions = {},
): Promise<CodexRateLimitSnapshot> {
  return mapCodexRateLimitResult(
    await codexAppServerRequest("account/rateLimits/read", undefined, options),
  );
}

export type CodexResetConsumeOutcome =
  | "reset"
  | "nothingToReset"
  | "noCredit"
  | "alreadyRedeemed";

/** Redeem one explicitly selected banked reset through Codex's idempotent API. */
export async function consumeCodexRateLimitResetCredit(
  input: { creditId: string; idempotencyKey: string },
  options: CodexAppServerOptions = {},
): Promise<CodexResetConsumeOutcome> {
  const result = await codexAppServerRequest(
    "account/rateLimitResetCredit/consume",
    input,
    options,
  );
  const outcome = result && typeof result === "object"
    ? (result as Record<string, unknown>).outcome
    : null;
  if (
    outcome !== "reset" &&
    outcome !== "nothingToReset" &&
    outcome !== "noCredit" &&
    outcome !== "alreadyRedeemed"
  ) {
    throw new Error("Codex returned an unknown reset outcome");
  }
  return outcome;
}
