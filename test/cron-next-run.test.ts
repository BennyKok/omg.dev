import { describe, expect, spyOn, test } from "bun:test";
import * as web from "../web/src/cron";
import * as mobile from "../mobile/src/omg/cron";

for (const [name, cron] of [["web", web], ["mobile", mobile]] as const) {
  describe(`${name} schedule previews`, () => {
    const cases = [
      ["* * * * *", "UTC", "2026-10-12T04:00:35Z", "2026-10-12T04:01:00Z"],
      ["0 9 1 * *", "Asia/Hong_Kong", "2026-10-12T04:00:00Z", "2026-11-01T01:00:00Z"],
      ["0 0 1 1 *", "UTC", "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"],
      ["0 0 29 2 *", "UTC", "2027-02-01T00:00:00Z", "2028-02-29T00:00:00Z"],
      ["0 9 * * 1", "Asia/Kathmandu", "2026-10-12T04:00:00Z", "2026-10-19T03:15:00Z"],
      ["5,35 8-12/2 * * *", "UTC", "2026-10-12T08:35:00Z", "2026-10-12T10:05:00Z"],
      // Missing and repeated hours. Search absolute time, never normalize a
      // nonexistent wall time or lose the second occurrence of an hour.
      ["30 2 * * *", "America/New_York", "2026-03-08T06:59:00Z", "2026-03-09T06:30:00Z"],
      ["30 1 * * *", "America/New_York", "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"],
      ["30 2 * * *", "Australia/Lord_Howe", "2026-10-03T15:00:00Z", "2026-10-03T15:30:00Z"],
      ["45 1 * * *", "Australia/Lord_Howe", "2026-04-04T14:45:00Z", "2026-04-04T15:15:00Z"],
    ];
    for (const [expr, tz, from, expected] of cases) {
      test(`${expr} in ${tz} from ${from}`, () => {
        const next = cron.nextRunAt(expr!, tz!, Date.parse(from!));
        expect(next).toBe(Date.parse(expected!));
        expect(cron.cronMatches(expr!, new Date(next!), tz!)).toBe(true);
      });
    }

    test("matches the original minute scan for lists, ranges and steps", () => {
      const from = Date.parse("2026-10-12T04:00:00Z");
      for (const expr of ["*/17 8-23 * * *", "5,35 9-17 * * 1-5", "0 */6 * * *"]) {
        for (const tz of ["UTC", "Asia/Kathmandu", "America/Los_Angeles"]) {
          let expected = from + 60_000;
          while (!cron.cronMatches(expr, new Date(expected), tz) && expected < from + 2 * 86400_000) expected += 60_000;
          expect(cron.nextRunAt(expr, tz, from)).toBe(expected);
        }
      }
    });

    test("an impossible date costs at most two timezone reads per day", () => {
      const spy = spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
      try {
        expect(cron.nextRunAt("0 0 31 2 *", "UTC", Date.parse("2026-01-01T00:00:00Z"))).toBeNull();
        expect(spy.mock.calls.length).toBeLessThanOrEqual(802);
      } finally { spy.mockRestore(); }
    });

    test("reuses a future result but expires it at the run and on clock reversal", () => {
      const from = Date.parse("2026-10-12T00:00:00Z");
      const expr = "23 7 * * *";
      const next = cron.nextRunAt(expr, "UTC", from)!;
      const spy = spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
      try {
        expect(cron.nextRunAt(expr, "UTC", from + 30_000)).toBe(next);
        expect(cron.nextRunAt(expr, "UTC", next - 1)).toBe(next);
        expect(spy.mock.calls.length).toBe(0);
        expect(cron.nextRunAt(expr, "UTC", next)).toBe(next + 86400_000);
        expect(cron.nextRunAt(expr, "UTC", from - 86400_000)).toBe(next - 86400_000);
        expect(cron.nextRunAt(expr, "Asia/Hong_Kong", from)).not.toBe(next);
      } finally { spy.mockRestore(); }
    });

    test("keeps the 400-day horizon and rejects fields with no matching values", () => {
      expect(cron.nextRunAt("0 0 29 2 *", "UTC", Date.parse("2026-01-01T00:00:00Z"))).toBeNull();
      for (const expr of ["bad", "60 * * * *", "0 24 * * *", "0 0 * 13 *", "0 0 * * 7"]) {
        expect(cron.nextRunAt(expr, "UTC", Date.now())).toBeNull();
      }
    });
  });
}
