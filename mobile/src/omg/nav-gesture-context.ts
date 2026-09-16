import { createContext, useContext } from "react";

/** Descendants exclude their current touch sequence from the drawer owner. */
export const NavGestureContext = createContext<(() => void) | undefined>(undefined);
export function useBlockNavGesture() {
  return useContext(NavGestureContext);
}
