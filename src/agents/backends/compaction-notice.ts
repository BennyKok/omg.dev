/** Routine native compaction is silent. Only a completed failure needs a notice. */
export function compactionFailureNotice(
  provider: string,
  outcome: { failed: boolean; aborted?: boolean; willRetry?: boolean },
): string | null {
  if (!outcome.failed || outcome.aborted || outcome.willRetry) return null;
  return `${provider} could not complete automatic context maintenance.`;
}
