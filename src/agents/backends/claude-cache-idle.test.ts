import { describe, expect, test } from "bun:test";
import { ClaudeCacheIdle } from "./claude-cache-idle.ts";

const minute = 60_000;
const idle = { idle: true, autoCompactEnabled: true };
const longUsage = {
  input_tokens: 10,
  cache_creation_input_tokens: 200_000,
  cache_creation: { ephemeral_1h_input_tokens: 200_000 },
};
function warm(automatic = true) {
  const cache = new ClaudeCacheIdle(automatic);
  cache.userActivity();
  cache.requestStarted(0);
  cache.observeUsage(longUsage);
  return cache;
}

describe("Claude idle cache maintenance", () => {
  test("warns once, then compacts once before the one-hour cache expires", () => {
    const cache = warm();
    expect(cache.tick(49 * minute, idle)).toBeNull();
    expect(cache.tick(50 * minute, idle)?.type).toBe("warn");
    expect(cache.tick(51 * minute, idle)).toBeNull();
    expect(cache.tick(54 * minute, idle)?.type).toBe("compact");
    expect(cache.tick(55 * minute, idle)).toBeNull();
    // The summary itself must not start an hourly compaction loop.
    cache.requestStarted(55 * minute);
    cache.observeUsage(longUsage);
    expect(cache.tick(109 * minute, idle)).toBeNull();
  });

  test("waits for an idle session, and never compacts after expiry", () => {
    const cache = warm();
    expect(cache.tick(54 * minute, { ...idle, idle: false })).toBeNull();
    expect(cache.tick(55 * minute, idle)?.type).toBe("warn");
    expect(cache.tick(55 * minute + 15_000, idle)?.type).toBe("compact");
    expect(warm().tick(60 * minute, idle)).toBeNull();
    expect(warm().tick(90 * minute, idle)).toBeNull();
    expect(warm().tick(-1, idle)).toBeNull();
  });

  test("warns without auto-compacting small contexts or disabled sessions", () => {
    for (const cache of [warm(false), warm()]) {
      const options = { ...idle, autoCompactEnabled: false };
      expect(cache.tick(50 * minute, options)?.text).toContain("Send /compact");
      expect(cache.tick(54 * minute, options)).toBeNull();
    }
    const cache = warm();
    cache.observeUsage({ ...longUsage, cache_creation_input_tokens: 1000 });
    expect(cache.tick(50 * minute, idle)?.text).toContain("Send /compact");
    expect(cache.tick(54 * minute, idle)).toBeNull();
    const disabled = warm(false);
    expect(disabled.tick(50 * minute, idle)?.text).toContain("Send /compact");
    expect(disabled.tick(54 * minute, idle)).toBeNull();
  });

  test("five-minute and mixed caches warn at four minutes without auto-compaction", () => {
    for (const long of [0, 100_000]) {
      const cache = warm();
      cache.observeUsage({ ...longUsage, cache_creation: {
        ephemeral_5m_input_tokens: 100_000, ephemeral_1h_input_tokens: long,
      } });
      expect(cache.tick(3 * minute, idle)).toBeNull();
      expect(cache.tick(4 * minute, idle)?.text).toContain("Send /compact");
      expect(cache.tick(4.5 * minute, idle)).toBeNull();
      expect(cache.tick(54 * minute, idle)).toBeNull();
    }
  });

  test("unknown TTLs do not invent a deadline", () => {
    const cache = new ClaudeCacheIdle();
    cache.requestStarted(0);
    cache.observeUsage({ cache_read_input_tokens: 300_000 });
    expect(cache.tick(50 * minute, idle)).toBeNull();
    cache.observeUsage({ cache_creation_input_tokens: 300_000 });
    expect(cache.tick(50 * minute, idle)).toBeNull();
    const previouslyWarm = warm();
    previouslyWarm.observeUsage({ cache_creation_input_tokens: 300_000 });
    expect(previouslyWarm.tick(50 * minute, idle)).toBeNull();
  });

  test("cache hits refresh the known TTL from request start, not response completion", () => {
    const cache = warm();
    cache.userActivity();
    cache.requestStarted(20 * minute);
    cache.observeUsage({ cache_read_input_tokens: 300_000 });
    expect(cache.tick(54 * minute, idle)).toBeNull();
    expect(cache.tick(70 * minute, idle)?.type).toBe("warn");
    expect(cache.tick(74 * minute, idle)?.type).toBe("compact");
  });

  test("failed requests, compaction, and runtime replacement invalidate the timer", () => {
    const cache = warm();
    cache.userActivity();
    expect(cache.tick(50 * minute, idle)).toBeNull();
    cache.requestStarted(0);
    expect(cache.tick(50 * minute, idle)).toBeNull();
    cache.observeUsage(longUsage);
    cache.invalidate();
    expect(cache.tick(54 * minute, idle)).toBeNull();
    cache.userActivity();
    cache.requestStarted(60 * minute);
    cache.observeUsage({ cache_read_input_tokens: 300_000 });
    expect(cache.tick(110 * minute, idle)).toBeNull();
    cache.observeUsage(longUsage);
    expect(cache.tick(110 * minute, idle)?.type).toBe("warn");
  });
});
