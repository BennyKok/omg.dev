const MINUTE = 60_000;

type Usage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number;
    ephemeral_5m_input_tokens?: number;
  };
};

export type CacheIdleAction = { type: "warn" | "compact"; text: string };

/** One owner for cache timers in SDK sessions. No network calls or keepalive requests. */
export class ClaudeCacheIdle {
  private ttl: number | null = null;
  private requestAt: number | null = null;
  private tokens = 0;
  private warned = false;
  private attempted = false;
  private suspended = false;
  private responded = false;

  constructor(private readonly automatic = true) {}

  /** Requesting status precedes the response; generation time counts against TTL. */
  requestStarted(now: number): void {
    this.requestAt = now;
    this.warned = false;
    this.responded = false;
    // A compaction request must not arm another compaction of its own summary.
  }

  userActivity(): void {
    this.attempted = false;
    this.suspended = false;
    this.requestAt = null;
  }

  invalidate(): void {
    this.ttl = null;
    this.requestAt = null;
    this.suspended = true;
  }

  observeUsage(usage: Usage): void {
    if (this.suspended) return;
    this.responded = true;
    const short = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    const long = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    // Mixed TTLs only prove that part of the prefix lasts an hour. Use the
    // shorter lifetime, and never automatically compact such a conversation.
    if (short > 0) this.ttl = 5 * MINUTE;
    else if (long > 0) this.ttl = 60 * MINUTE;
    else if ((usage.cache_creation_input_tokens ?? 0) > 0) this.ttl = null;
    else if (!((usage.cache_read_input_tokens ?? 0) > 0)) this.ttl = null;
    this.tokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
      + (usage.cache_creation_input_tokens ?? 0);
  }

  tick(now: number, options: { idle: boolean; autoCompactEnabled: boolean }): CacheIdleAction | null {
    if (!options.idle || !this.responded || this.suspended || this.requestAt === null || this.ttl === null) return null;
    const age = now - this.requestAt;
    // Never try to "save" a cache after it has already expired, including after
    // sleep or a stalled event loop. The server does not expose an expiry event.
    if (age < 0 || age >= this.ttl) return null;
    const canCompact = this.automatic && options.autoCompactEnabled
      && this.ttl === 60 * MINUTE && this.tokens >= 200_000 && !this.attempted;
    // Warn only when we can perform maintenance ourselves. A cache miss on
    // an ineligible session does not create a manual task for the person.
    if (canCompact && !this.warned && age >= 50 * MINUTE) {
      this.warned = true;
      return {
        type: "warn",
        text: "This conversation's prompt cache is expected to expire soon. If the session stays idle, omg.dev will summarize older context automatically. You do not need to take any action.",
      };
    }
    if (canCompact && age >= 54 * MINUTE) {
      this.attempted = true;
      this.suspended = true;
      return {
        type: "compact",
        text: "Compacting this idle conversation before its prompt cache is expected to expire.",
      };
    }
    return null;
  }
}
