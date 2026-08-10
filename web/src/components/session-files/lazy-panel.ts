// The Files panel's code-split entry point.
//
// Files opens from the session ⋮ menu, and a dropdown item unmounts the moment
// the menu closes — so the panel itself has to be rendered by the menu's owner,
// not by the item. Keeping the lazy handle in its own module lets that owner
// import it without pulling the panel (and @pierre/trees, @pierre/diffs'
// editor, jsdiff underneath it) into the first-paint bundle: the chunk only
// resolves once a user actually opens Files.

import { lazyWithReload } from "@/lib/lazy-with-reload";

export const LazySessionFilesPanel = lazyWithReload(
  "session-files-panel",
  () => import("./SessionFilesPanel"),
);

export default LazySessionFilesPanel;
