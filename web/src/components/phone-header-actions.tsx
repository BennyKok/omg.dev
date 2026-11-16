/**
 * A PAGE'S ACTIONS, DRAWN IN THE PHONE HEADER.
 *
 * A phone page has one header bar: Back, the page's name, and the page's
 * actions on the right (the shell draws it, see App.tsx and
 * lib/side-nav-items.ts, mobileHeader). The actions belong to the page, which
 * owns their state, so the page renders them and this moves them into the
 * bar with a portal.
 *
 * Before this, the name went up into the bar and the actions stayed behind.
 * Dashboard and Schedules were left with a row that held only "Edit" or
 * "New", pushed to the right under an empty header corner.
 *
 * Off a phone there is no slot, and the actions stay where the page put them.
 */
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The header's action slot. Null when the shell draws no phone header. */
export const PhoneHeaderSlotContext = createContext<HTMLElement | null>(null);

/** The slot, for a page that must know whether its actions left the page. */
export function usePhoneHeaderSlot(): HTMLElement | null {
  return useContext(PhoneHeaderSlotContext);
}

export function PhoneHeaderActions({ children }: { children: ReactNode }) {
  const slot = usePhoneHeaderSlot();
  return slot ? createPortal(children, slot) : <>{children}</>;
}
