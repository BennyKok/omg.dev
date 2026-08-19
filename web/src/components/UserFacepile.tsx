import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildFacepile, type FacepileMember } from "@/lib/facepile";

/**
 * An overlapping stack of user icons ("facepile") — who is on a machine, at a
 * glance. Sibling of BotAvatar.tsx (the mascot avatar) but for real people:
 * same instinct of "the circle carries the identity, no extra plate behind
 * it", adapted for photos instead of a procedural silhouette.
 *
 * Two things make small overlapping circles read as separate people instead
 * of a smear: the ring between them (a `ring-background` border, which tracks
 * the light/dark theme token automatically — see the same trick on the
 * unread-count dot elsewhere in this app) and z-index running in visual
 * (left-to-right) order so the ring always sits on top of the circle behind
 * it, in both directions.
 *
 * Accessibility: the stack is one group with one label ("Benny and Angel", or
 * "No one on this machine") — every avatar image is `aria-hidden`/`alt=""` so
 * a screen reader announces the stack once, not once per circle.
 */
export function UserFacepile({
  members,
  size = 24,
  maxVisible = 4,
  className,
}: {
  members: FacepileMember[];
  /** Diameter of each circle, in px. */
  size?: number;
  /** How many circles to draw before folding the rest into a "+N" badge. */
  maxVisible?: number;
  className?: string;
}) {
  const { visible, overflowCount, label } = buildFacepile(members, maxVisible);
  const overlap = Math.round(size * 0.32);
  const ring = size <= 20 ? 1.5 : 2;

  if (visible.length === 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size, boxShadow: `0 0 0 ${ring}px var(--background)` }}
        role="img"
        aria-label={label}
        title={label}
      >
        <UserRound className="size-1/2" aria-hidden />
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex items-center", className)}
      role="img"
      aria-label={label}
      title={label}
    >
      {visible.map((member, i) => (
        <span
          key={member.email}
          className="relative shrink-0 overflow-hidden rounded-full bg-muted"
          style={{
            width: size,
            height: size,
            marginLeft: i === 0 ? 0 : -overlap,
            zIndex: visible.length - i,
            boxShadow: `0 0 0 ${ring}px var(--background)`,
          }}
        >
          {member.avatar ? (
            <img src={member.avatar} alt="" aria-hidden className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-muted-foreground">
              <UserRound aria-hidden style={{ width: size * 0.55, height: size * 0.55 }} />
            </span>
          )}
        </span>
      ))}
      {overflowCount > 0 ? (
        <span
          className="relative flex shrink-0 items-center justify-center rounded-full bg-foreground text-background"
          style={{
            width: size,
            height: size,
            marginLeft: -overlap,
            zIndex: 0,
            boxShadow: `0 0 0 ${ring}px var(--background)`,
            fontSize: Math.max(9, size * 0.36),
            fontWeight: 600,
          }}
          aria-hidden
        >
          +{overflowCount}
        </span>
      ) : null}
    </span>
  );
}
