/** statusFor() labels the binary row "<Product> CLI" or "pi runtime". */
export function isBinaryCheck(label: string): boolean {
  return /CLI$|runtime$/i.test(label);
}

export function binaryMissing(checks: { label: string; ok: boolean }[]): boolean {
  return checks.some((check) => isBinaryCheck(check.label) && !check.ok);
}

/**
 * What the collapsed agent row says on its right edge.
 *
 * One quiet word when the agent cannot run. When it can, the row names the
 * account it is signed in as, because "ready" is the moment the user wants to
 * know WHICH login this is — several agents on one machine are often connected
 * under different accounts. A ready agent that records no identity stays
 * silent, exactly as before.
 */
export function agentStatusNote(
  checks: { label: string; ok: boolean }[],
  profile?: { label: string } | null,
  connectedAccounts = 0,
): string | null {
  const failing = checks.filter((check) => !check.ok);
  if (failing.length) {
    if (failing.some((check) => isBinaryCheck(check.label))) return "Install";
    return "Connect";
  }
  // Claude can hold several logins at once. Naming just the first would assert
  // that one account IS this agent, which is the opposite of what the row has
  // to say — the count is the honest summary, and the expanded rows name each
  // one. A single account has nothing to disambiguate, so it shows its address.
  if (connectedAccounts > 1) return `${connectedAccounts} accounts`;
  return profile?.label ?? null;
}
