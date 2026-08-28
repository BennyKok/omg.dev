export type ParentProcessEnvironment = Record<string, string | undefined>;

export function desktopParentPid(
  env: ParentProcessEnvironment = process.env,
  ownPid: number = process.pid,
): number | null {
  const raw = env.OMG_DESKTOP_PARENT_PID?.trim() || env.LFG_DESKTOP_PARENT_PID?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const pid = Number(raw);
  return Number.isSafeInteger(pid) && pid > 1 && pid !== ownPid ? pid : null;
}

/**
 * Stop an embedded server if its desktop parent disappears without a normal
 * quit event. Normal local services do not set the parent variable and keep
 * their existing independent lifecycle.
 */
export function installDesktopParentGuard(
  env: ParentProcessEnvironment = process.env,
): Timer | null {
  const parentPid = desktopParentPid(env);
  if (parentPid == null) return null;
  delete env.OMG_DESKTOP_PARENT_PID;
  delete env.LFG_DESKTOP_PARENT_PID;

  return setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      process.exit(0);
    }
  }, 2_000);
}
