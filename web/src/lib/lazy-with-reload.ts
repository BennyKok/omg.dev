import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

// Production SPAs hit a classic failure right after a redeploy: a client still
// running the PREVIOUS build renders a route that pulls in a code-split chunk
// whose hashed filename no longer exists on the server. Our static server falls
// back to serving index.html for any unknown path (SPA routing), so the dynamic
// import() does NOT reject — it "succeeds" with an HTML document parsed as an ES
// module, whose named export is therefore `undefined`. React then throws the
// minified error #306 ("Element type is invalid. Received a promise that
// resolves to: undefined. Lazy element type must resolve to a class or
// function.") and the nearest error boundary blanks the view.
//
// lazyWithReload wraps a dynamic import so that when the expected export is
// missing (or the import outright fails), we force ONE full-page reload to pull
// the fresh index.html and its current chunk hashes — transparently moving the
// user onto the new build. A per-component sessionStorage latch prevents a
// reload loop if the failure is genuine (e.g. the export really was renamed in
// this build), in which case we rethrow so the error boundary can show a
// recoverable fallback instead.

function recoverFromStaleChunk(latchKey: string): never {
  let alreadyReloaded = false;
  try {
    alreadyReloaded = sessionStorage.getItem(latchKey) === "1";
    if (!alreadyReloaded) sessionStorage.setItem(latchKey, "1");
  } catch {
    // sessionStorage can throw (private mode / storage disabled). Fall through
    // and rethrow below so the error boundary still renders its fallback.
  }
  if (!alreadyReloaded && typeof window !== "undefined") {
    window.location.reload();
    // reload() doesn't stop synchronous execution; block here so React never
    // gets a resolved-but-undefined module to choke on during the unload.
    throw new Error(`Reloading to recover stale chunk: ${latchKey}`);
  }
  // We already reloaded once and it's STILL broken — this is a real bug, not a
  // stale chunk. Throw so the nearest error boundary shows its fallback.
  throw new Error(`Code-split chunk failed to load after reload: ${latchKey}`);
}

/**
 * Like React.lazy, but resilient to the post-deploy stale-chunk failure that
 * surfaces as React error #306. `name` identifies the chunk for the reload
 * latch (so one genuinely-broken chunk can't reload-loop another's recovery).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a generic lazy
// wrapper must accept components with arbitrary prop shapes, exactly like
// React.lazy itself; `unknown` here would reject any component that takes props.
export function lazyWithReload<T extends ComponentType<any>>(
  name: string,
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  const latchKey = `lfg:chunk-reload:${name}`;
  return lazy(async () => {
    try {
      const mod = await load();
      if (!mod || typeof mod.default === "undefined") {
        // Loaded, but the export is missing — the hallmark of index.html being
        // served in place of a chunk whose hash changed under us.
        return recoverFromStaleChunk(latchKey);
      }
      // Loaded cleanly → we're on a good build. Clear the latch so a future
      // deploy is free to trigger another one-time recovery reload.
      try {
        sessionStorage.removeItem(latchKey);
      } catch {
        /* ignore */
      }
      return mod;
    } catch (err) {
      // Outright network/parse failure (a chunk 404 that did NOT fall back to
      // HTML, or a syntax error) — same recovery path.
      if (
        err instanceof Error &&
        err.message.startsWith("Reloading to recover stale chunk")
      ) {
        throw err; // already handled by recoverFromStaleChunk — don't double-wrap
      }
      return recoverFromStaleChunk(latchKey);
    }
  });
}
