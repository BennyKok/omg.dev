// GoDaddy refused sign-in from a UTC browser on a Los Angeles or Helsinki
// address and accepted the same browser in the matching zone. These tests pin
// how the desktop's Chrome picks that zone.
import { beforeEach, expect, test } from "bun:test";
import { TIME_ZONE_TTL_MS, browserTimeZone, resetBrowserTimeZoneCache, validTimeZone } from "./timezone.ts";

beforeEach(() => resetBrowserTimeZoneCache());

const fixed = (zone: string | null) => {
  const calls: (string | undefined)[] = [];
  const lookup = async (proxy?: string) => { calls.push(proxy); return zone; };
  return { calls, lookup };
};

test("uses the exit address's zone", async () => {
  const { lookup } = fixed("Europe/Helsinki");
  expect(await browserTimeZone({ env: {}, lookup })).toBe("Europe/Helsinki");
});

test("OMG_COMPUTER_TZ wins and skips the lookup", async () => {
  const { calls, lookup } = fixed("Europe/Helsinki");
  expect(await browserTimeZone({ env: { OMG_COMPUTER_TZ: "America/Los_Angeles" }, lookup })).toBe("America/Los_Angeles");
  expect(calls).toHaveLength(0);
});

test("OMG_COMPUTER_TZ=off keeps the inherited zone", async () => {
  const { calls, lookup } = fixed("Europe/Helsinki");
  expect(await browserTimeZone({ env: { OMG_COMPUTER_TZ: "off" }, lookup })).toBeNull();
  expect(calls).toHaveLength(0);
});

test("an invalid override falls back to the lookup", async () => {
  const { lookup } = fixed("Asia/Hong_Kong");
  expect(await browserTimeZone({ env: { OMG_COMPUTER_TZ: "Mars/Olympus" }, lookup })).toBe("Asia/Hong_Kong");
});

test("a failed or bad lookup never blocks the launch", async () => {
  expect(await browserTimeZone({ env: {}, lookup: async () => { throw new Error("offline"); } })).toBeNull();
  expect(await browserTimeZone({ env: {}, lookup: async () => "Not/AZone" })).toBeNull();
});

test("a found zone is reused, refreshed after the TTL, and kept when a refresh fails", async () => {
  let now = 1_000;
  let zone: string | null = "Europe/Helsinki";
  let calls = 0;
  const lookup = async () => { calls++; if (zone === null) throw new Error("offline"); return zone; };
  const pick = () => browserTimeZone({ env: {}, lookup, now: () => now });
  expect(await pick()).toBe("Europe/Helsinki");
  now += 1_000;
  expect(await pick()).toBe("Europe/Helsinki");
  expect(calls).toBe(1);
  now += TIME_ZONE_TTL_MS;
  zone = "America/Los_Angeles";
  expect(await pick()).toBe("America/Los_Angeles");
  now += TIME_ZONE_TTL_MS;
  zone = null;
  expect(await pick()).toBe("America/Los_Angeles");
  expect(calls).toBe(3);
});

test("the lookup goes through Chrome's proxy, and the cache is per proxy", async () => {
  const { calls, lookup } = fixed("Europe/Helsinki");
  await browserTimeZone({ env: {}, lookup, proxy: "http://proxy:8080" });
  await browserTimeZone({ env: {}, lookup });
  expect(calls).toEqual(["http://proxy:8080", undefined]);
});

test("validTimeZone accepts IANA names only", () => {
  expect(validTimeZone("Europe/Helsinki")).toBe(true);
  expect(validTimeZone("UTC")).toBe(true);
  expect(validTimeZone("")).toBe(false);
  expect(validTimeZone("Not/AZone")).toBe(false);
});
