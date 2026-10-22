// The phone's home composer on the Create view. The composer stays docked at
// the bottom, as on every other page, so an open keyboard never moves it. On
// Create the dock is clear (no bar background, shadow or fade), so the page's
// backdrop shows behind it. The heading and the tutorials are the page's
// (CreateHome in apps-home.tsx).

import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export function CreateComposerFrame({
  create,
  hidden,
  children,
}: {
  /** The Create view: a clear dock over the page backdrop. */
  create: boolean;
  /** Apps, or an app waiting for "Change something". Kept mounted so a draft survives. */
  hidden: boolean;
  children: ReactNode;
}) {
  // `contents`, so the composer keeps its place in the shell's column.
  return (
    <div
      className={cn(
        hidden ? "hidden" : "contents",
        create && "[&>*]:!bg-transparent [&>*]:!shadow-none [&>*]:before:!hidden",
      )}
    >
      {children}
    </div>
  );
}
