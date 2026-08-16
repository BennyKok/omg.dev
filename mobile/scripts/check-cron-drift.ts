/**
 * Fail if the native cron helpers have drifted from the web ones.
 *
 * src/omg/cron.ts is a hand-maintained port of web/src/cron.ts, because
 * mobile/ is not a workspace member and cannot import from web/. Same shape,
 * and same reasoning, as scripts/check-attachment-drift.ts: a copy with no
 * guard is a copy that silently rots, and the failure mode here is quiet
 * rather than loud — the phone would keep rendering a schedule label that is
 * merely WRONG, which nobody reports as a bug because it still looks like a
 * schedule.
 *
 * The comparison is BEHAVIOURAL, not textual. Comparing source would fail on a
 * reworded comment while passing a real semantic change made in both files at
 * once. It also has to be, because the port is a strict subset: the picker
 * half of web/src/cron.ts (buildCron/parseToSimple) drives an editor the phone
 * does not have, so only the exports the phone actually uses are checked.
 *
 * `from` is pinned rather than Date.now() so a run at 23:59 cannot fail on a
 * date rolling over between the two calls, and so a failure reproduces.
 *
 * Run: bun run scripts/check-cron-drift.ts
 */

import * as native from "../src/omg/cron";

const WEB_PATH = new URL("../../web/src/cron.ts", import.meta.url).pathname;

if (!(await Bun.file(WEB_PATH).exists())) {
  console.error(`Could not read ${WEB_PATH} — is the web workspace present?`);
  process.exit(2);
}

const web = (await import(WEB_PATH)) as typeof native;

/**
 * Every expression shape the describer recognises, every one it deliberately
 * refuses, and the real schedules currently on the box — because the shapes a
 * human types in the picker are not the only shapes that reach this code. The
 * half-hourly-within-a-range and multi-hour-list cases below are live agents,
 * and both fall through to the raw-expression fallback; if a future edit
 * "improves" one of them on only one side, that is exactly the drift this
 * catches.
 */
const CASES: string[] = [
  "",
  "   ",
  "not a cron",
  "0 11 * * *",
  "0 9 * * *",
  "*/30 * * * *",
  "*/1 * * * *",
  "*/10 * * * *",
  "*/20 * * * *",
  "0 * * * *",
  "25 * * * *",
  "15 * * * *",
  "0 */6 * * *",
  "15 */6 * * *",
  "15 */4 * * *",
  "0 */1 * * *",
  "30 9 * * 1-5",
  "0 9 * * 0,6",
  "0 10 * * 1",
  "0 9 * * 1",
  "50 8 * * 1",
  "0 9 * * 1,3,5",
  "10 10 1 * *",
  "0 0 21 * *",
  "0 0 22 * *",
  "0 0 23 * *",
  // Live schedules that the describer cannot express and must pass through raw.
  "*/30 8-23 * * *",
  "0 8,13,18 * * *",
  "35 8 * * *",
  "10 9 * * *",
  "20 9 * * *",
  "40 9 * * *",
  "45 9 * * *",
  "0 14 * * *",
  "0 11 15 6 *",
  // Field syntax that only the matcher sees.
  "0 0 * * 7",
  "5,35 * * * *",
  "0 9-17 * * *",
  "0 0 1,15 * *",
  // Too many / too few fields.
  "0 11 * *",
  "0 11 * * * *",
];

const TZS = ["Asia/Hong_Kong", "UTC", "America/Los_Angeles", "Europe/London", "Pacific/Kiritimati"];

// A fixed instant: 2026-08-16T04:00:00Z. Late enough in the UTC day that the
// Hong Kong and Los Angeles calendar dates differ, which is the case a
// timezone bug in either copy would show up on.
const FROM = Date.UTC(2026, 7, 16, 4, 0, 0);

const LOCALES = [undefined, "en-US", "de-DE"];

let failures = 0;
function check(what: string, a: unknown, b: unknown) {
  if (Object.is(a, b)) return;
  failures++;
  console.error(`DRIFT ${what}\n  native: ${JSON.stringify(a)}\n  web:    ${JSON.stringify(b)}`);
}

for (const expr of CASES) {
  check(`isValidCron(${JSON.stringify(expr)})`, native.isValidCron(expr), web.isValidCron(expr));

  for (const locale of LOCALES) {
    check(
      `describeCron(${JSON.stringify(expr)}, ${JSON.stringify(locale)})`,
      native.describeCron(expr, locale),
      web.describeCron(expr, locale),
    );
  }

  for (const tz of TZS) {
    check(
      `nextRunAt(${JSON.stringify(expr)}, ${tz})`,
      native.nextRunAt(expr, tz, FROM),
      web.nextRunAt(expr, tz, FROM),
    );
    // Probe the matcher directly across a day, so an off-by-one in a field
    // that nextRunAt happens to step over still gets seen.
    for (let h = 0; h < 24; h += 3) {
      const d = new Date(FROM + h * 3_600_000);
      check(
        `cronMatches(${JSON.stringify(expr)}, +${h}h, ${tz})`,
        native.cronMatches(expr, d, tz),
        web.cronMatches(expr, d, tz),
      );
    }
  }
}

check("DEFAULT_SCHED_TZ", native.DEFAULT_SCHED_TZ, web.DEFAULT_SCHED_TZ);

if (failures) {
  console.error(`\n${failures} difference(s) between mobile/src/omg/cron.ts and web/src/cron.ts.`);
  process.exit(1);
}
console.log(`cron port matches web/src/cron.ts (${CASES.length} expressions × ${TZS.length} zones).`);
