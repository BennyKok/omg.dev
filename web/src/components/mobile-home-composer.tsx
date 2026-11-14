import { useLayoutEffect, type ReactNode, type RefObject } from "react";
import { cn } from "../lib/utils";

/** Keep the home draft alive while a full-screen chat owns input. */
export function MobileHomeComposer({ covered, busy = false, containerRef, children }: {
  covered: boolean;
  busy?: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    if (!covered) return;
    const container = containerRef.current;
    const active = container?.ownerDocument.activeElement;
    if (active instanceof HTMLElement && container?.contains(active)) active.blur();
  }, [covered, containerRef]);

  return (
    <div
      ref={containerRef}
      aria-busy={busy}
      inert={covered}
      aria-hidden={covered}
      className={cn(
        "mobile-scroll-composer-fade relative z-[55] mt-auto shrink-0 overflow-x-clip bg-background/95 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur-xl",
        covered ? "invisible pointer-events-none" : "pointer-events-auto",
      )}
    >
      {children}
    </div>
  );
}
