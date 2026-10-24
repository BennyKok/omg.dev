// The host's tutorials on the phone Create page (OmgAppSurfaceProps.tutorials).
//
// The surface draws the cards itself, under the heading. The host owns the
// list, each run's progress, and what Start or Continue does. It hands them in
// as a small store, because a kept-alive surface can keep the props of its
// first render: reading through useSyncExternalStore keeps the cards current
// as the person moves between pages.

import { useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { useEmbeddedHostOptions, type HostTutorialCard, type HostTutorials } from "@/lib/embedded-host-options";
import { cn } from "@/lib/utils";

const NO_CARDS: readonly HostTutorialCard[] = [];
const noSubscribe = () => () => {};
const noCards = () => NO_CARDS;

/** The host's tutorial cards now, or none without a host or a list. */
export function useHostTutorialCards(): { tutorials: HostTutorials | undefined; cards: readonly HostTutorialCard[] } {
  const { tutorials } = useEmbeddedHostOptions();
  const cards = useSyncExternalStore(tutorials?.subscribe ?? noSubscribe, tutorials?.getCards ?? noCards, noCards);
  return { tutorials, cards };
}

/** How many cards the desktop grid shows; "See all" opens the rest. */
const GRID_CARDS = 3;

/**
 * `row`: one swipeable row that runs to the screen's edges (the phone).
 * `grid`: the first three side by side inside the column (the desktop home),
 * where an edge-to-edge row was cut off at the column's edge and a mouse
 * cannot swipe it.
 */
export function CreateTutorials({ layout = "row" }: { layout?: "row" | "grid" } = {}) {
  const { tutorials, cards: allCards } = useHostTutorialCards();
  if (!tutorials || !allCards.length) return null;
  const grid = layout === "grid";
  const cards = grid ? allCards.slice(0, GRID_CARDS) : allCards;
  return (
    <section data-testid="create-tutorials" className="pt-3 pb-4">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Tutorials</span>
        {tutorials.onSeeAll ? (
          <button
            type="button"
            onClick={() => tutorials.onSeeAll?.()}
            aria-label="See all tutorials"
            className="-my-1.5 -mr-1.5 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <ChevronRight className="size-5" />
          </button>
        ) : null}
      </div>
      {/* One swipeable row. Each card is a little under half the width, so the
          next one peeks in once there are more than two. */}
      <div
        className={
          grid
            ? "grid grid-cols-3 gap-3"
            : "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto overscroll-x-contain px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        }
      >
        {cards.map((card) => {
          const running = card.status === "continue";
          return (
            <button
              key={card.id}
              type="button"
              data-testid={`create-tutorial-${card.id}`}
              disabled={card.disabled}
              onClick={() => tutorials.onSelect(card.id)}
              className={cn(
                "flex flex-col overflow-hidden rounded-2xl border border-border bg-card/90 text-left shadow-sm backdrop-blur-sm disabled:opacity-60",
                grid
                  ? "min-w-0 transition-transform hover:-translate-y-0.5 hover:shadow-md"
                  : "w-[46%] min-w-[164px] max-w-[210px] shrink-0 snap-start",
              )}
            >
              <span className="relative block h-[112px] bg-gradient-to-b from-primary/10 to-transparent">
                <img
                  src={card.imageUrl}
                  alt=""
                  loading="lazy"
                  className="absolute left-1/2 top-3 h-[100px] w-[58px] -translate-x-1/2 rounded-[10px] border-[3px] border-foreground/85 object-cover object-top shadow-md"
                />
                {running ? (
                  <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    In progress
                  </span>
                ) : null}
              </span>
              <span className="block px-3 pb-3 pt-2.5">
                <span className="block truncate text-[14px] font-semibold">{card.title}</span>
                {running ? (
                  <span className="block text-[12px] font-semibold text-primary">Continue</span>
                ) : (
                  <span className="block truncate text-[12px] text-muted-foreground">{card.detail}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
