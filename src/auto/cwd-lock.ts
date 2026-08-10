// The AI-SDK backend runs in-process and we scope an agent's working directory
// with a global process.chdir, so two concurrent runs would clobber each
// other's cwd. Everything that chdir's for a run (the scheduler's auto runs AND
// the one-shot compose/enhance passes) funnels through this single lock so the
// chdir→run→restore is serialized across ALL callers.

let runChain: Promise<unknown> = Promise.resolve();

export function withCwdLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = runChain.catch(() => {}).then(fn);
  runChain = run.catch(() => {});
  return run;
}

/**
 * Run `fn` with `process.env` temporarily replaced.
 *
 * Same bargain as the cwd above: the AI-SDK backend runs in-process and
 * deliberately lets the Agent SDK inherit `process.env`, so pinning a run to a
 * particular Claude account means swapping the process environment for its
 * duration. That is only safe because every caller is already serialized by the
 * lock in this module — call it INSIDE `runInCwd`/`withCwdLock`, never outside.
 */
export async function withProcessEnv<T>(
  env: Record<string, string> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!env) return await fn();
  const prev = { ...process.env };
  try {
    // Replace, don't merge: the point of the account env is that it DROPS the
    // platform proxy/auth variables that would otherwise override the account's
    // own credentials, so keys missing from it have to actually go away.
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in prev)) delete process.env[key];
    for (const [key, value] of Object.entries(prev)) {
      if (value !== undefined) process.env[key] = value;
    }
  }
}

// Run `fn` with the process cwd temporarily set to `cwd`, serialized against
// every other cwd-scoped run and always restoring the previous cwd.
export function runInCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  return withCwdLock(async () => {
    const prev = process.cwd();
    try {
      process.chdir(cwd);
    } catch {}
    try {
      return await fn();
    } finally {
      try {
        process.chdir(prev);
      } catch {}
    }
  });
}
