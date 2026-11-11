import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one set of building blocks for the Settings pages.
 *
 * Settings grew section by section, and each section drew its own label, card,
 * row padding and icon tile. The result was a page where some groups had a
 * label and some did not, notes sat inside some cards and under others, and
 * icon tiles were black, blue, grey or missing for no reason. Every group and
 * row on the Settings pages goes through these components so they cannot drift
 * apart again.
 */

const ROW_CLASS = "flex w-full min-h-12 items-center gap-3 px-4 py-2.5 text-left";
const PRESSABLE_CLASS =
  "transition-colors duration-150 ease-ios hover:bg-foreground/[0.03] active:bg-foreground/[0.06]";

/** A labelled group: quiet label, one card, optional note under the card. */
export function SettingsGroup({
  label,
  labelId,
  footer,
  children,
  className,
}: {
  label?: ReactNode;
  labelId?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)} aria-labelledby={label ? labelId : undefined}>
      {label ? <SettingsGroupLabel id={labelId}>{label}</SettingsGroupLabel> : null}
      <SettingsCard>{children}</SettingsCard>
      {footer ? <SettingsNote>{footer}</SettingsNote> : null}
    </section>
  );
}

/** Not uppercased: see RailGroup. A shouted label was the loudest text on the page. */
export function SettingsGroupLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="px-4 text-xs font-semibold text-muted-foreground">
      {children}
    </h2>
  );
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
      {children}
    </div>
  );
}

/** Explanatory text under a card. Always outside the card, never inside it. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return <div className="px-4 text-xs leading-relaxed text-muted-foreground">{children}</div>;
}

/**
 * The square tile in front of a row. One tone for every row; `warning` is the
 * only exception, and it is reserved for a state that needs attention.
 */
export function SettingsIcon({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "warning" }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-[7px] [&_svg]:size-4",
        tone === "warning" ? "bg-warning text-white" : "bg-foreground text-background",
      )}
    >
      {children}
    </span>
  );
}

function RowBody({
  icon,
  title,
  description,
  descriptionClassName,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  descriptionClassName?: string;
}) {
  return (
    <>
      {icon ?? null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {description != null && description !== "" ? (
          <span className={cn("block text-xs text-muted-foreground", descriptionClassName)}>{description}</span>
        ) : null}
      </span>
    </>
  );
}

/**
 * One settings row: icon, title, optional description, and a trailing control.
 * With `onClick` the whole row is a button and shows a chevron, which marks
 * it as a link to another page.
 */
export function SettingsRow({
  icon,
  title,
  description,
  descriptionClassName,
  trailing,
  onClick,
  className,
  ...rest
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  descriptionClassName?: string;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
  "aria-disabled"?: boolean;
  "aria-label"?: string;
}) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(ROW_CLASS, PRESSABLE_CLASS, className)} {...rest}>
        <RowBody icon={icon} title={title} description={description} descriptionClassName={descriptionClassName} />
        {trailing ?? null}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
    );
  }
  return (
    <div className={cn(ROW_CLASS, className)} {...rest}>
      <RowBody icon={icon} title={title} description={description} descriptionClassName={descriptionClassName} />
      {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
    </div>
  );
}

/** The pill around a native select, used for every numeric choice. */
export function SettingsSelect({
  id,
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
  children,
}: {
  id?: string;
  value: string | number;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label": string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex shrink-0 items-center gap-1 rounded-full bg-muted px-3 py-1.5", disabled && "opacity-50")}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        // Sized to the chosen value, not to the widest option, so every pill
        // on the page is as wide as what it shows.
        className="appearance-none bg-transparent text-right text-xs font-medium outline-none field-sizing-content"
      >
        {children}
      </select>
      <ChevronDown className="size-3 text-muted-foreground/70" />
    </label>
  );
}

/**
 * A group whose label opens and closes it. Same label position as every other
 * group, so a collapsed group reads as a heading, not as a stray card.
 */
export function SettingsDisclosure({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mx-4 inline-flex items-center gap-1.5 rounded-md text-left text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")} />
      </button>
      {open ? <div className="space-y-6">{children}</div> : null}
    </div>
  );
}
