// A host's tutorial guide card (ComposerGuide.card), drawn by the surface.
//
// The host (omg.dev) owns the run: its steps, what each one says, and what
// its buttons do. The surface owns where the card goes and how it looks. The
// card is a normal block at the top of the composer it belongs to, so it is
// part of the page flow: the chat above it gets shorter, and nothing is ever
// drawn on top of the chat, the preview card or the tutorial cards. There is
// no floating fallback. A composer the card does not belong to shows one
// "resume" row (the home composer) or nothing (another chat).
//
// What to act on next (the field, the mic, Send) is ringed with CSS on the
// composer's own elements: GuideComposerSlot's form sets
// data-lfg-guide-focus, and index.css draws the ring (no measured overlay).

import { Suspense, useSyncExternalStore } from "react";
import {
  useEmbeddedHostOptions,
  type ComposerGuideSurface,
  type HostGuideCard,
  type HostGuideCardStore,
} from "@/lib/embedded-host-options";
import { lazyWithReload } from "@/lib/lazy-with-reload";

// The drawn card is its own chunk: it loads only while a tutorial runs, so
// it adds nothing to the surface's first load (omg.dev holds that to a budget).
const GuideCardView = lazyWithReload("TutorialGuideCard", () => import("./tutorial-guide-card"));

const noSubscribe = () => () => {};
const noCard = () => null;

/** The host's guide card now, or null without a host card. */
export function useHostGuideCard(): { store: HostGuideCardStore | undefined; card: HostGuideCard | null } {
  const { composerGuide } = useEmbeddedHostOptions();
  const store = composerGuide?.card;
  const card = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getCard ?? noCard, noCard);
  return { store, card };
}

/** True when `card` belongs to this composer. */
export function guideCardFor(
  card: HostGuideCard | null,
  surface: ComposerGuideSurface,
  sessionId?: string | null,
): boolean {
  if (!card || card.surface !== surface) return false;
  return surface === "new-session" || (!!sessionId && card.sessionId === sessionId);
}

/**
 * The ring target for a composer's form (data-lfg-guide-focus). Undefined
 * unless this composer's card asks for one.
 */
export function useGuideFocus(surface: ComposerGuideSurface, sessionId?: string | null): HostGuideCard["focus"] {
  const { card } = useHostGuideCard();
  if (!card || !guideCardFor(card, surface, sessionId)) return undefined;
  if (card.collapsed) return undefined;
  return card.ready ? "send" : card.focus;
}

/**
 * True while the home composer holds the guide's card. The Create page then
 * steps its tutorial cards and the getting-started list aside: the person
 * already picked a tutorial, and the card is the one thing to do.
 */
export function useHomeGuideActive(): boolean {
  const { card } = useHostGuideCard();
  return guideCardFor(card, "new-session");
}

/**
 * The card's step key, or null. A composer reports its draft again when this
 * changes: a draft restored before the guide was listening (a reload) never
 * reached it, and "Fill it in" with the same text is not a change.
 */
export function useGuideCardKey(): string | null {
  return useHostGuideCard().card?.key ?? null;
}

/** True while any guide card is open. */
export function useGuideRunning(): boolean {
  return useHostGuideCard().card !== null;
}

/**
 * The card's place at the top of a composer. `fill` sets this composer's
 * draft and returns false when the field is not on screen.
 */
export function GuideComposerSlot({
  surface,
  sessionId,
  fill,
  className,
}: {
  surface: ComposerGuideSurface;
  sessionId?: string | null;
  fill: (text: string) => boolean | void;
  className?: string;
}) {
  const { store, card } = useHostGuideCard();
  if (!store || !card) return null;
  const own = guideCardFor(card, surface, sessionId);
  // Home, while the run waits in its own chat: one row back to it.
  const resume = !own && surface === "new-session" && card.surface === "session";
  if (!own && !resume) return null;
  return (
    <Suspense fallback={null}>
      <GuideCardView
        key={card.key}
        mode={own ? "card" : "resume"}
        store={store}
        card={card}
        fill={fill}
        className={className}
      />
    </Suspense>
  );
}
