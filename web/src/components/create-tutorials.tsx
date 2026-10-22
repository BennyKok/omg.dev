// The host's tutorials on the phone Create page (OmgAppSurfaceProps.tutorials).
//
// The surface draws the cards itself, below the chat box. The host owns the
// list, each run's progress, and what Start or Continue does. It hands them in
// as a small store, because a kept-alive surface can keep the props of its
// first render: reading through useSyncExternalStore keeps the cards current
// as the person moves between pages.

import { useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { useEmbeddedHostOptions, type HostTutorialCard, type HostTutorials } from "@/lib/embedded-host-options";

const NO_CARDS: readonly HostTutorialCard[] = [];
const noSubscribe = () => () => {};
const noCards = () => NO_CARDS;

/** The host's tutorial cards now, or none without a host or a list. */
export function useHostTutorialCards(): { tutorials: HostTutorials | undefined; cards: readonly HostTutorialCard[] } {
  const { tutorials } = useEmbeddedHostOptions();
  const cards = useSyncExternalStore(tutorials?.subscribe ?? noSubscribe, tutorials?.getCards ?? noCards, noCards);
  return { tutorials, cards };
}

export function CreateTutorials() {
  const { tutorials, cards } = useHostTutorialCards();
  if (!tutorials || !cards.length) return null;
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
      <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto overscroll-x-contain px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {cards.map((card) => {
          const running = card.status === "continue";
          return (
            <button
              key={card.id}
              type="button"
              data-testid={`create-tutorial-${card.id}`}
              disabled={card.disabled}
              onClick={() => tutorials.onSelect(card.id)}
              className="flex w-[46%] min-w-[164px] max-w-[210px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border bg-card/90 text-left shadow-sm backdrop-blur-sm disabled:opacity-60"
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
