export type PersistentBotQuota = {
  used: number;
  limit: number | null;
  remaining: number | null;
  scope: "owner" | "legacy_pool";
  source: "default" | "config" | "host_entitlement" | "legacy";
};

export type BotQuotaPresentation = {
  usage: string;
  limitMessage: string | null;
  reached: boolean;
};

/** Pure copy model so mobile and desktop render the same quota facts. */
export function botQuotaPresentation(quota: PersistentBotQuota): BotQuotaPresentation {
  if (quota.limit === null || quota.remaining === null) {
    return {
      usage: `${quota.used} ownerless legacy bot${quota.used === 1 ? "" : "s"} stored. ` +
        "They do not use a personal bot allowance.",
      limitMessage: null,
      reached: false,
    };
  }
  const reached = quota.remaining === 0;
  return {
    usage: `${quota.used} of ${quota.limit} persistent bots used · ${quota.remaining} remaining`,
    limitMessage: reached
      ? `You have ${quota.used} of ${quota.limit} persistent bots. Delete a bot before creating another.`
      : null,
    reached,
  };
}
