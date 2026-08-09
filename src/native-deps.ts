// Deferred loading for the two heavyweight native dependencies.
//
// `sharp` and `playwright` each carry a large native addon plus a wide JS
// module graph. Importing them costs roughly 100 MB and 90 MB of RSS
// respectively, measured as the delta over a bare `Bun.serve` process — and
// that cost is paid at import time, whether or not the process ever encodes an
// image or drives a browser.
//
// `lfg serve` reaches both transitively (artifact previews pull sharp; the
// browser-login endpoints pull playwright), so a plain top-level import made
// every server pay ~190 MB before serving its first request. On a 512 MiB
// free-plan Cloud Computer guest that is most of the budget, and it left too
// little headroom for a coding agent to run alongside: opencode was OOM-killed
// shortly after launch on box3 (finding 455c98f58649).
//
// Loading them on first use keeps the idle server small. The vast majority of
// sessions never touch either path, and the ones that do pay the import once —
// the module registry caches it, and these helpers cache the promise so
// concurrent callers share a single load.
//
// Import *types* from the packages directly (`import type`), which erases at
// compile time; only value access needs to route through here.

let sharpPromise: Promise<typeof import("sharp").default> | null = null;

/** Load `sharp` on demand. Cached, so concurrent callers share one import. */
export function loadSharp(): Promise<typeof import("sharp").default> {
  sharpPromise ??= import("sharp").then((m) => m.default);
  return sharpPromise;
}

let chromiumPromise: Promise<typeof import("playwright").chromium> | null = null;

/**
 * Load playwright's `chromium` on demand.
 *
 * playwright is not installed by default. Its driver was 20MB of a 109MB
 * install, shipped to everyone for a feature most sessions never touch — and
 * the ~150MB browser it actually needs was never provisioned by setup anyway,
 * so a default install could not drive a browser regardless.
 *
 * A missing package must therefore read as "not installed", not as a stack
 * trace: the import throws ERR_MODULE_NOT_FOUND, which says nothing about how
 * to fix it.
 */
export function loadChromium(): Promise<typeof import("playwright").chromium> {
  chromiumPromise ??= import("playwright")
    .then((m) => m.chromium)
    .catch((cause) => {
      chromiumPromise = null; // let a later call retry after an install
      throw new Error(
        "The browser tool needs playwright, which is not installed. "
          + "Install it with `OMG_INSTALL_BROWSER=1 omg setup`.",
        { cause },
      );
    });
  return chromiumPromise;
}
