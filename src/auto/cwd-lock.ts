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
