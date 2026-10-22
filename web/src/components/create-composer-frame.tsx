// Places the phone's home composer for the Create view: under "What do you
// want to make?", with the page's app row under it, the group centred in the
// space below the header. The composer itself does not change. The frame
// publishes its height as --lfg-create-top-h; the page publishes the height of
// what it draws under the composer as --lfg-create-below-h; both use
// CREATE_OFFSET for the empty space above the group.

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/utils";

/** Space above the heading that centres heading, composer and app row in the screen. */
export const CREATE_OFFSET =
  "max(0px, (var(--lfg-app-height, 100dvh) - var(--lfg-mobile-header-height, 0px) - var(--lfg-create-top-h, 16rem) - var(--lfg-create-below-h, 0px)) / 2 - 2rem)";

export function CreateComposerFrame({
  centered,
  hidden,
  children,
}: {
  centered: boolean;
  /** Apps, or an app waiting for "Change something". Kept mounted so a draft survives. */
  hidden: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!centered || !ref.current) return;
    const root = document.documentElement;
    const el = ref.current;
    const publish = () => root.style.setProperty("--lfg-create-top-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, [centered]);
  return (
    <div
      ref={ref}
      style={centered && !hidden ? { top: `calc(var(--lfg-mobile-header-height, 0px) + ${CREATE_OFFSET})` } : undefined}
      // Not centered: `contents`, so the composer keeps its place in the shell's column.
      className={cn(
        hidden
          ? "hidden"
          : centered
            ? // The dock is drawn on the page here: no bar background, shadow or fade.
              "absolute inset-x-0 z-30 pb-1 [&>*]:!bg-transparent [&>*]:!shadow-none [&>*]:before:!hidden"
            : "contents",
      )}
    >
      {centered && !hidden ? (
        // The header already says "Welcome, Benny", so no second greeting here.
        <h1 className="px-5 pb-3 text-[22px] font-bold leading-tight tracking-[-0.02em]">What do you want to make?</h1>
      ) : null}
      {children}
    </div>
  );
}
