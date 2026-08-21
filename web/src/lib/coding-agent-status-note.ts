/** statusFor() labels the binary row "<Product> CLI" or "pi runtime". */
export function isBinaryCheck(label: string): boolean {
  return /CLI$|runtime$/i.test(label);
}

export function binaryMissing(checks: { label: string; ok: boolean }[]): boolean {
  return checks.some((check) => isBinaryCheck(check.label) && !check.ok);
}

/** One quiet word when the agent cannot run. Ready rows stay silent. */
export function agentStatusNote(
  checks: { label: string; ok: boolean }[],
): "Install" | "Connect" | null {
  const failing = checks.filter((check) => !check.ok);
  if (!failing.length) return null;
  if (failing.some((check) => isBinaryCheck(check.label))) return "Install";
  return "Connect";
}
