import type { RateLimitResetCredit, RateLimitResetCredits } from "@/lib/usage";

function formatDateTime(
  epochSeconds: number,
  locale?: string,
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(epochSeconds * 1000));
}

function CreditDates({
  credit,
  locale,
  timeZone,
  onUse,
  using,
  disabled,
}: {
  credit: RateLimitResetCredit;
  locale?: string;
  timeZone?: string;
  onUse?: (credit: RateLimitResetCredit) => void;
  using?: boolean;
  disabled?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-4 border-l-2 border-primary/30 py-1 pl-3 text-xs">
      <div className="min-w-0">
        <p className="font-medium text-foreground">
          {credit.title || "Rate-limit reset"}
        </p>
        <p className="tabular-nums text-muted-foreground">
          {credit.expiresAt == null
            ? "Expiry not supplied"
            : `Expires ${formatDateTime(credit.expiresAt, locale, timeZone)}`}
        </p>
        {credit.grantedAt != null ? (
          <p className="text-[11px] text-muted-foreground/70">
            Granted {formatDateTime(credit.grantedAt, locale, timeZone)}
          </p>
        ) : null}
      </div>
      {onUse ? (
        <button
          type="button"
          onClick={() => onUse(credit)}
          disabled={!credit.id || credit.status !== "available" || disabled}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {using ? "Using…" : "Use reset"}
        </button>
      ) : null}
    </li>
  );
}

export function BankedResetCredits({
  value,
  locale,
  timeZone,
  onUse,
  usingCreditId,
}: {
  value: RateLimitResetCredits;
  /** Test and embedded-host override. The normal app uses the device locale. */
  locale?: string;
  /** Test and embedded-host override. The normal app uses the device timezone. */
  timeZone?: string;
  onUse?: (credit: RateLimitResetCredit) => void;
  usingCreditId?: string | null;
}) {
  const rows = value.credits;
  const missingDetails = rows == null
    ? value.availableCount
    : Math.max(0, value.availableCount - rows.length);

  return (
    <div className="space-y-3" aria-label="Banked Codex resets">
      <div className="rounded-xl bg-primary/10 px-3 py-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Banked resets
        </p>
        <p className="text-base font-bold tabular-nums text-foreground">
          {value.availableCount} {value.availableCount === 1 ? "reset" : "resets"} available
        </p>
      </div>
      {rows?.length ? (
        <ul className="space-y-2">
          {rows.map((credit, index) => (
            <CreditDates
              key={`${credit.grantedAt ?? "unknown"}-${credit.expiresAt ?? "unknown"}-${index}`}
              credit={credit}
              locale={locale}
              timeZone={timeZone}
              onUse={onUse}
              using={usingCreditId === credit.id}
              disabled={usingCreditId != null}
            />
          ))}
        </ul>
      ) : null}
      {missingDetails > 0 ? (
        <p className="text-[11px] text-muted-foreground/70">
          {rows == null
            ? "Codex returned the total, but no expiry details."
            : `${missingDetails} more ${missingDetails === 1 ? "reset" : "resets"}; Codex did not return their expiry details.`}
        </p>
      ) : value.availableCount === 0 ? (
        <p className="text-[11px] text-muted-foreground/70">No banked resets available.</p>
      ) : null}
      {onUse ? (
        <p className="text-[11px] text-muted-foreground/70">
          Using one immediately resets your current Codex rate-limit window.
        </p>
      ) : null}
    </div>
  );
}
