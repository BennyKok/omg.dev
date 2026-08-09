// Deferred loading for sharp, the one heavyweight native dependency left.
//
// sharp carries a large native addon plus a wide JS module graph, costing
// roughly 100 MB of RSS over a bare `Bun.serve` process — paid at import time,
// whether or not the process ever encodes an image. `lfg serve` reaches it
// transitively (artifact previews pull sharp), so a plain top-level import made
// every server pay that before serving its first request. On a 512 MiB
// free-plan Cloud Computer guest that is most of the budget, and it left too
// little headroom for a coding agent to run alongside: opencode was OOM-killed
// shortly after launch on box3 (finding 455c98f58649).
//
// Loading it on first use keeps the idle server small. Most sessions never
// encode an image, and the ones that do pay the import once — the module
// registry caches it, and the helper caches the promise so concurrent callers
// share a single load.
//
// Import *types* from the package directly (`import type`), which erases at
// compile time; only value access needs to route through here.

let sharpPromise: Promise<typeof import("sharp").default> | null = null;

/** Load `sharp` on demand. Cached, so concurrent callers share one import. */
export function loadSharp(): Promise<typeof import("sharp").default> {
  sharpPromise ??= import("sharp").then((m) => m.default);
  return sharpPromise;
}
