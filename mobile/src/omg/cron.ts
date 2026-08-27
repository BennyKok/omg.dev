/**
 * Cron helpers for the phone — a hand-maintained port of web/src/cron.ts.
 *
 * An auto agent IS a prompt plus a schedule, so a row that shows one without
 * the other is showing half the object. The schedule on the wire is a raw
 * 5-field cron expression (`0 11 * * *`), which is not a thing to put in front
 * of a person; the web turns it into "Every day at 11:00 AM · next in 3h" and
 * the phone has to say the same words, or the two surfaces describe the same
 * agent two different ways.
 *
 * WHY A COPY. mobile/ is not a workspace member and cannot import from web/ —
 * same constraint that produced src/omg/message-attachments.ts. A copy with no
 * guard rots silently, so scripts/check-cron-drift.ts runs both
 * implementations over the same expressions and fails when they disagree.
 * That checker is the reason this file is a LITERAL port: the matching and
 * describe logic below is web/src/cron.ts's, line for line, so a diff between
 * the two is short enough to actually read.
 *
 * Only the read-side is ported. The picker half (buildCron/parseToSimple) is
 * for an editor the phone does not have, and formatRelative is deliberately
 * left behind — see nextRunLabel in auto-agent-card.tsx for why the phone
 * spells the relative part itself.
 *
 * THE TIMEZONE IS THE MACHINE'S, NOT THE PHONE'S. The backend scheduler
 * evaluates wall-clock in the global-settings timezone (`tz` comes down with
 * GET /api/auto/agents), so nextRunAt takes it explicitly. Reading the
 * schedule in the phone's own zone would tell someone in a different country
 * the wrong time for every agent they own.
 */

const DOW: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export const DEFAULT_SCHED_TZ = "Asia/Hong_Kong";

// ---- matching (ported from the backend so the UI agrees with it) ----

function fieldMatch(field: string, value: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10) || 1;
      if (range === "*") {
        if (value % step === 0) return true;
        continue;
      }
      const [lo, hi] = range.split("-").map((n) => parseInt(n, 10));
      if (!Number.isNaN(lo)) {
        const top = Number.isNaN(hi) ? lo : hi;
        for (let v = lo; v <= top; v += step) if (v === value) return true;
      }
      continue;
    }
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((n) => parseInt(n, 10));
      if (!Number.isNaN(a) && !Number.isNaN(b) && value >= a && value <= b) return true;
      continue;
    }
    if (parseInt(part, 10) === value) return true;
  }
  return false;
}

// Intl.DateTimeFormat construction is expensive (~tens of µs). nextRunAt scans
// minute-by-minute, so building one per iteration dominated the cost and made
// the list lag. Cache one formatter per timezone.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function zonedFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      minute: "2-digit",
      hour: "2-digit",
      day: "2-digit",
      month: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function zonedParts(d: Date, tz: string) {
  const parts = Object.fromEntries(
    zonedFormatter(tz)
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return {
    minute: parseInt(parts.minute as string, 10),
    hour: parseInt(parts.hour as string, 10),
    dom: parseInt(parts.day as string, 10),
    month: parseInt(parts.month as string, 10),
    dow: DOW[parts.weekday as string] ?? 0,
  };
}

export function isValidCron(expr: string): boolean {
  return expr.trim().split(/\s+/).length === 5;
}

export function cronMatches(expr: string, d: Date, tz: string): boolean {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const p = zonedParts(d, tz);
  return (
    fieldMatch(f[0], p.minute) &&
    fieldMatch(f[1], p.hour) &&
    fieldMatch(f[2], p.dom) &&
    fieldMatch(f[3], p.month) &&
    fieldMatch(f[4], p.dow)
  );
}

// Next minute (> from) at which the cron fires, in the scheduler tz. Scans up to
// ~400 days forward; returns null if nothing matches (or expr is invalid).
export function nextRunAt(expr: string, tz: string, from: number = Date.now()): number | null {
  if (!isValidCron(expr)) return null;
  const start = Math.floor(from / 60_000) * 60_000 + 60_000; // next whole minute
  const maxMinutes = 400 * 24 * 60;
  for (let i = 0; i < maxMinutes; i++) {
    const t = start + i * 60_000;
    if (cronMatches(expr, new Date(t), tz)) return t;
  }
  return null;
}

// ---- describe (cron -> locale English) ----

function timeLabel(h: number, m: number, locale?: string): string {
  const d = new Date(Date.UTC(2024, 0, 1, h, m));
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

function weekdayName(dow: number, locale?: string): string {
  const d = new Date(Date.UTC(2024, 0, 7 + (dow % 7))); // 2024-01-07 is a Sunday
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(d);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const intRe = /^\d+$/;
const listRe = /^\d+(,\d+)*$/;

export function describeCron(expr: string, locale?: string): string {
  const trimmed = expr.trim();
  const f = trimmed.split(/\s+/);
  if (f.length !== 5) return trimmed || "(no schedule)";
  const [min, hr, dom, mon, dow] = f;
  const allDate = dom === "*" && mon === "*" && dow === "*";

  // Every N minutes
  const stepMin = min.match(/^\*\/(\d+)$/);
  if (stepMin && hr === "*" && allDate) {
    const n = parseInt(stepMin[1], 10);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  // Every N hours
  const stepHr = hr.match(/^\*\/(\d+)$/);
  if (intRe.test(min) && stepHr && allDate) {
    const n = parseInt(stepHr[1], 10);
    return n === 1 ? "Every hour" : `Every ${n} hours`;
  }
  // Hourly at :mm
  if (intRe.test(min) && hr === "*" && allDate) {
    const m = parseInt(min, 10);
    return m === 0 ? "Every hour" : `Every hour at :${String(m).padStart(2, "0")}`;
  }

  // From here we need a concrete time of day.
  if (!intRe.test(min) || !intRe.test(hr)) return trimmed;
  const at = `at ${timeLabel(parseInt(hr, 10), parseInt(min, 10), locale)}`;

  // Daily / weekday / weekend / specific weekday(s)
  if (dom === "*" && mon === "*") {
    if (dow === "*") return `Every day ${at}`;
    if (dow === "1-5") return `Every weekday ${at}`;
    if (dow === "0,6" || dow === "6,0" || dow === "0,6,") return `Every weekend ${at}`;
    if (intRe.test(dow)) return `Every ${weekdayName(parseInt(dow, 10), locale)} ${at}`;
    if (listRe.test(dow)) {
      const days = dow
        .split(",")
        .map((d) => weekdayName(parseInt(d, 10), locale))
        .join(", ");
      return `Every ${days} ${at}`;
    }
    return trimmed;
  }

  // Monthly on the Nth
  if (intRe.test(dom) && mon === "*" && dow === "*") {
    return `Monthly on the ${ordinal(parseInt(dom, 10))} ${at}`;
  }

  return trimmed;
}
