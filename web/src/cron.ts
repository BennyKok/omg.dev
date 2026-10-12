// Self-contained, dependency-free cron helpers for the web UI.
//
// The schedule is a standard 5-field cron expression (minute hour day-of-month
// month day-of-week), interpreted by the backend scheduler in the user's global
// settings timezone — NOT the browser's TZ. So nextRunAt() takes that tz and
// evaluates wall-clock there, mirroring src/auto/scheduler.ts. describeCron() is
// a "cronstrue-lite": it turns the
// common patterns the picker produces into locale-aware English; anything it
// doesn't recognise falls back to the raw expression.

export const DEFAULT_SCHED_TZ = "Asia/Hong_Kong";

const DOW: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

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

// Reuse the timezone formatter across matching and next-run previews.
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

// Keep repeated renders cheap without retaining an unbounded schedule history.
const nextRunCache = new Map<string, { from: number; next: number | null }>();
const MAX_NEXT_RUN_CACHE = 256;

// Next minute (> from) at which the cron fires, within the same 400-day
// horizon as the scheduler preview. Inspect calendar days, not every minute.
// A day whose UTC offset changes falls back to the minute scan, preserving
// missing/repeated wall times (including half-hour DST changes).
export function nextRunAt(expr: string, tz: string, from: number = Date.now()): number | null {
  if (!isValidCron(expr) || !Number.isFinite(from)) return null;
  const start = Math.floor(from / 60_000) * 60_000 + 60_000;
  const key = JSON.stringify([expr, tz]);
  const cached = nextRunCache.get(key);
  if (cached && start >= cached.from &&
      (cached.next === null ? start === cached.from : start <= cached.next)) {
    return cached.next;
  }
  const fields = expr.trim().split(/\s+/);
  const allowed = fields.map((field, index) => {
    const min = index === 2 || index === 3 ? 1 : 0;
    const max = [59, 23, 31, 12, 6][index];
    const values = new Set<number>();
    for (let value = min; value <= max; value++) {
      if (fieldMatch(field, value)) values.add(value);
    }
    return values;
  });
  const remember = (next: number | null) => {
    nextRunCache.delete(key);
    if (nextRunCache.size >= MAX_NEXT_RUN_CACHE) {
      nextRunCache.delete(nextRunCache.keys().next().value!);
    }
    nextRunCache.set(key, { from: start, next });
    return next;
  };
  if (allowed.some((values) => values.size === 0)) return remember(null);
  const times: number[] = [];
  for (const hour of allowed[1]) for (const minute of allowed[0]) times.push(hour * 60 + minute);
  const dateMatches = (p: ReturnType<typeof zonedParts>) =>
    allowed[2].has(p.dom) && allowed[3].has(p.month) && allowed[4].has(p.dow);
  const end = start + 400 * 24 * 60 * 60_000;
  for (let t = start; t < end;) {
    const p = zonedParts(new Date(t), tz);
    const minuteOfDay = p.hour * 60 + p.minute;
    const span = Math.min(1440 - minuteOfDay, (end - t) / 60_000);
    const last = zonedParts(new Date(t + (span - 1) * 60_000), tz);
    const steady = last.dom === p.dom && last.month === p.month && last.dow === p.dow &&
      last.hour * 60 + last.minute === minuteOfDay + span - 1;
    if (steady) {
      if (dateMatches(p)) {
        const candidate = times.find((minute) => minute >= minuteOfDay && minute < minuteOfDay + span);
        if (candidate !== undefined) return remember(t + (candidate - minuteOfDay) * 60_000);
      }
    } else {
      for (let i = 0; i < span; i++) {
        const instant = t + i * 60_000;
        const at = i === 0 ? p : zonedParts(new Date(instant), tz);
        if (dateMatches(at) && allowed[1].has(at.hour) && allowed[0].has(at.minute)) {
          return remember(instant);
        }
      }
    }
    t += span * 60_000;
  }
  return remember(null);
}

// ---- locale-aware relative time ("in 3h", "in 2 days") ----

export function formatRelative(target: number, locale?: string, now: number = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffMs = target - now;
  const sec = Math.round(diffMs / 1000);
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(Math.round(sec), "second");
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return rtf.format(min, "minute");
  const hr = Math.round(sec / 3600);
  if (Math.abs(hr) < 24) return rtf.format(hr, "hour");
  const day = Math.round(sec / 86400);
  if (Math.abs(day) < 30) return rtf.format(day, "day");
  const month = Math.round(day / 30);
  if (Math.abs(month) < 12) return rtf.format(month, "month");
  return rtf.format(Math.round(day / 365), "year");
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

// ---- picker <-> cron (the "simple mode" of the editor) ----

export type SimpleFreq = "minutes" | "hourly" | "daily" | "weekday" | "weekly" | "monthly";

export type SimpleSchedule = {
  freq: SimpleFreq;
  time: string; // "HH:MM" 24h, for daily/weekday/weekly/monthly
  minute: number; // for hourly (minute of the hour) and minutes step lives in `every`
  every: number; // N, for "minutes"
  dow: number; // 0..6 for weekly
  dom: number; // 1..31 for monthly
};

export const DEFAULT_SIMPLE: SimpleSchedule = {
  freq: "daily",
  time: "09:00",
  minute: 0,
  every: 15,
  dow: 1,
  dom: 1,
};

export function buildCron(s: SimpleSchedule): string {
  const [hStr, mStr] = (s.time || "09:00").split(":");
  const h = Math.max(0, Math.min(23, parseInt(hStr, 10) || 0));
  const m = Math.max(0, Math.min(59, parseInt(mStr, 10) || 0));
  switch (s.freq) {
    case "minutes":
      return `*/${Math.max(1, Math.min(59, s.every))} * * * *`;
    case "hourly":
      return `${Math.max(0, Math.min(59, s.minute))} * * * *`;
    case "daily":
      return `${m} ${h} * * *`;
    case "weekday":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${s.dow}`;
    case "monthly":
      return `${m} ${h} ${s.dom} * *`;
    default:
      return `${m} ${h} * * *`;
  }
}

// Parse a cron string back into picker state, or null if it's not a shape the
// picker can represent (the editor then opens in Advanced mode).
export function parseToSimple(expr: string): SimpleSchedule | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hr, dom, mon, dow] = f;
  const base = { ...DEFAULT_SIMPLE };

  const stepMin = min.match(/^\*\/(\d+)$/);
  if (stepMin && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...base, freq: "minutes", every: parseInt(stepMin[1], 10) };
  }
  if (intRe.test(min) && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...base, freq: "hourly", minute: parseInt(min, 10) };
  }
  if (!intRe.test(min) || !intRe.test(hr)) return null;
  const time = `${hr.padStart(2, "0")}:${min.padStart(2, "0")}`;

  if (dom === "*" && mon === "*") {
    if (dow === "*") return { ...base, freq: "daily", time };
    if (dow === "1-5") return { ...base, freq: "weekday", time };
    if (intRe.test(dow)) return { ...base, freq: "weekly", time, dow: parseInt(dow, 10) };
    return null;
  }
  if (intRe.test(dom) && mon === "*" && dow === "*") {
    return { ...base, freq: "monthly", time, dom: parseInt(dom, 10) };
  }
  return null;
}
