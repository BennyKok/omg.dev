// Two small pieces left from the phone's Create and Apps pages, which are
// gone: the phone home is the chat list, with Folders in the drawer
// (components/phone-folders.tsx). The spinner marks a working row; the
// backdrop colours the desktop home stage.

import { useLayoutEffect } from "react";
import { cn } from "../lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={cn("size-3.5 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none", className)}
    />
  );
}

/**
 * Decoration only: soft color clouds that drift slowly behind the desktop
 * home stage. Gradients moved by transform, so the browser only composites
 * them. Still for people who ask for reduced motion. While hidden, the clouds
 * stop moving.
 */
export function CreateBackdrop({ shown, contained = false }: { shown: boolean; contained?: boolean }) {
  // While Create shows, the phone header drops its own background so the
  // backdrop runs under it (html.lfg-create-view in index.css), with the same fade.
  // A contained backdrop (the desktop home pane) leaves the header alone.
  useLayoutEffect(() => {
    if (!contained) document.documentElement.classList.toggle("lfg-create-view", shown);
  }, [shown, contained]);
  useLayoutEffect(() => () => {
    if (!contained) document.documentElement.classList.remove("lfg-create-view");
  }, [contained]);
  return (
    <div
      aria-hidden="true"
      // Fades out toward every edge (lfg-create-backdrop in index.css).
      // Contained: fills its positioned parent and sizes the glows to it.
      className={cn(
        "lfg-create-backdrop pointer-events-none inset-0 z-0 overflow-hidden transition-opacity duration-500 ease-out motion-reduce:transition-none",
        contained ? "lfg-create-backdrop-contained absolute rounded-[inherit]" : "fixed",
        shown ? "opacity-100 dark:opacity-90" : "lfg-create-backdrop-idle opacity-0",
      )}
    >
      <span className="lfg-create-cloud lfg-create-cloud-a" />
      <span className="lfg-create-cloud lfg-create-cloud-b" />
      <span className="lfg-create-cloud lfg-create-cloud-c" />
      <span className="lfg-create-cloud lfg-create-cloud-d" />
      <span className="lfg-create-cloud lfg-create-cloud-e" />
    </div>
  );
}
