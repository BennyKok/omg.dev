// The host's tutorials on the Create page (OmgAppSurfaceProps.tutorials).
//
// Two sections, each drawn only when the host lists cards for it:
//  - "Start something new": templates (`kind` "template", the default), as
//    picture cards in one swipeable row (the phone) or a grid (the desktop).
//  - "Learn a skill": skills (`kind` "skill") to add to an app the person has,
//    as a short list. `getSkillTarget` names that app.
// The host owns the lists, each run's progress, and what Start or Continue
// does. It hands them in as a small store, because a kept-alive surface can
// keep the props of its first render: reading through useSyncExternalStore
// keeps the cards current as the person moves between pages.

import { useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useEmbeddedHostOptions, type HostTutorialCard, type HostTutorials } from "@/lib/embedded-host-options";
import { cn } from "@/lib/utils";

const NO_CARDS: readonly HostTutorialCard[] = [];
const noSubscribe = () => () => {};
const noCards = () => NO_CARDS;
const noTarget = () => null;

/** The host's tutorial cards now, or none without a host or a list. */
export function useHostTutorialCards(): { tutorials: HostTutorials | undefined; cards: readonly HostTutorialCard[] } {
  const { tutorials } = useEmbeddedHostOptions();
  const cards = useSyncExternalStore(tutorials?.subscribe ?? noSubscribe, tutorials?.getCards ?? noCards, noCards);
  return { tutorials, cards };
}

/** How many template cards the desktop grid shows; "See all" opens the rest. */
const GRID_CARDS = 3;

const isSkill = (card: HostTutorialCard) => card.kind === "skill";

/**
 * `row`: one swipeable row of templates that runs to the screen's edges (the
 * phone). `grid`: the first three templates side by side inside the column
 * (the desktop home), where an edge-to-edge row was cut off at the column's
 * edge and a mouse cannot swipe it. Skills are a list in both.
 */
export function CreateTutorials({ layout = "row" }: { layout?: "row" | "grid" } = {}) {
  const { tutorials, cards } = useHostTutorialCards();
  const target = useSyncExternalStore(tutorials?.subscribe ?? noSubscribe, tutorials?.getSkillTarget ?? noTarget, noTarget);
  if (!tutorials || !cards.length) return null;
  const grid = layout === "grid";
  const allTemplates = cards.filter((card) => !isSkill(card));
  const templates = grid ? allTemplates.slice(0, GRID_CARDS) : allTemplates;
  const skills = cards.filter(isSkill);
  const seeAll = tutorials.onSeeAll ? () => tutorials.onSeeAll?.() : null;
  return (
    <section data-testid="create-tutorials" className="pt-1 pb-4">
      {templates.length ? (
        <>
          <SectionTitle title="Start something new" subtitle="Build an app or game, step by step" onSeeAll={seeAll} />
          {/* One swipeable row. Each card is a little under half the width, so
              the next one peeks in once there are more than two. */}
          <div
            className={
              grid
                ? "grid grid-cols-3 gap-3"
                : "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto overscroll-x-contain px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            }
          >
            {templates.map((card) => (
              <TemplateCard key={card.id} card={card} grid={grid} onSelect={() => tutorials.onSelect(card.id)} />
            ))}
          </div>
        </>
      ) : null}
      {skills.length ? (
        <>
          <SectionTitle
            title="Learn a skill"
            subtitle={
              target ? (
                <>
                  Add it to <span className="font-semibold text-foreground">{target}</span>
                </>
              ) : (
                "Add it to an app you made"
              )
            }
            onSeeAll={seeAll}
            spaced={templates.length > 0}
          />
          <div className="overflow-hidden rounded-2xl border border-border bg-card/90 shadow-sm backdrop-blur-sm">
            {skills.map((card) => (
              <SkillRow key={card.id} card={card} onSelect={() => tutorials.onSelect(card.id)} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function SectionTitle({
  title,
  subtitle,
  onSeeAll,
  spaced = false,
}: {
  title: string;
  subtitle: ReactNode;
  onSeeAll: (() => void) | null;
  spaced?: boolean;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-3 px-1 pb-2.5", spaced && "pt-5")}>
      <div className="min-w-0">
        <h2 className="text-[16px] font-bold leading-tight tracking-[-0.01em]">{title}</h2>
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{subtitle}</p>
      </div>
      {onSeeAll ? (
        <button
          type="button"
          onClick={onSeeAll}
          aria-label={`See all: ${title}`}
          className="-mr-1.5 mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <ChevronRight className="size-5" />
        </button>
      ) : null}
    </div>
  );
}

function TemplateCard({ card, grid, onSelect }: { card: HostTutorialCard; grid: boolean; onSelect: () => void }) {
  const running = card.status === "continue";
  return (
    <button
      type="button"
      data-testid={`create-tutorial-${card.id}`}
      disabled={card.disabled}
      onClick={onSelect}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border bg-card/90 text-left shadow-sm backdrop-blur-sm disabled:opacity-60",
        grid
          ? "min-w-0 transition-transform hover:-translate-y-0.5 hover:shadow-md"
          : "w-[42%] min-w-[150px] max-w-[200px] shrink-0 snap-start",
      )}
    >
      <span className="relative block h-[104px] bg-gradient-to-b from-primary/10 to-transparent">
        <img
          src={card.imageUrl}
          alt=""
          loading="lazy"
          className="absolute left-1/2 top-3 h-[92px] w-[54px] -translate-x-1/2 rounded-[10px] border-[3px] border-foreground/85 object-cover object-top shadow-md"
        />
        {running ? (
          <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
            In progress
          </span>
        ) : null}
      </span>
      <span className="block px-3 pb-3 pt-2.5">
        <span className="block text-[14px] font-semibold leading-tight">{card.title}</span>
        {running ? (
          <span className="block text-[12px] font-semibold text-primary">Continue</span>
        ) : (
          <span className="block truncate text-[12px] text-muted-foreground">{card.detail}</span>
        )}
      </span>
    </button>
  );
}

function SkillRow({ card, onSelect }: { card: HostTutorialCard; onSelect: () => void }) {
  const running = card.status === "continue";
  return (
    <button
      type="button"
      data-testid={`create-skill-${card.id}`}
      disabled={card.disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-3 border-t border-border/60 px-3 py-2.5 text-left first:border-t-0 hover:bg-muted/40 disabled:opacity-60"
    >
      <img src={card.iconUrl ?? card.imageUrl} alt="" loading="lazy" className="size-8 shrink-0 rounded-[10px] object-cover" />
      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{card.title}</span>
      {running ? (
        <span className="text-[12px] font-semibold text-primary">Continue</span>
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      )}
    </button>
  );
}
