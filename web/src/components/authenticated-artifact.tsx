import { useEffect, useState, type ReactNode } from "react";

import { artifactRequestPath } from "../lib/artifact-document";
import { omgDirectUrl, omgFetch } from "../lib/omg-client";
import { cn } from "../lib/utils";
import { ImageLightbox } from "./ImageLightbox";

type ArtifactLoad<T> =
  | { status: "loading"; value: null }
  | { status: "ready"; value: T }
  | { status: "error"; value: null };

/**
 * Where the bytes for one artifact come from.
 *
 * `direct` is a URL the browser loads itself, straight out of an element's
 * `src`. Everything else is the blob path: fetch through the transport, wrap
 * the response in an object URL, revoke it on unmount.
 *
 * The distinction is the whole point of this file. An object URL is owned by
 * the component that made it, and the transcript is virtualized, so a row that
 * scrolls off screen unmounts, revokes its URL, and downloads the same picture
 * again the moment it comes back. A direct URL lives in the browser's HTTP
 * cache instead — the server marks artifact bytes `immutable` for a year — so
 * the second mount costs nothing and paints at once.
 */
type ArtifactSource = { status: "direct"; value: string } | ArtifactLoad<string>;

/** @param path `null` defers the fetch entirely (used to load full-size bytes only on zoom). */
function useArtifactBlobUrl(path: string | null): ArtifactLoad<string> {
  const [state, setState] = useState<ArtifactLoad<string>>({
    status: "loading",
    value: null,
  });

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState({ status: "loading", value: null });
    void omgFetch(path, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`artifact ${response.status}`);
        objectUrl = URL.createObjectURL(await response.blob());
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setState({ status: "ready", value: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "error", value: null });
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return state;
}

/**
 * Ask the transport for a directly loadable URL, and fall back to the blob.
 *
 * Standalone LFG serves the UI and the runtime from one origin, so the element
 * can fetch the artifact itself with the same cookies — no header to inject,
 * nothing to revoke. A hosted surface installs a transport that signs each
 * request with a short-lived grant, an `<img>` cannot carry that header, and
 * `assetUrl` returns null there. An older host, bundled against a client that
 * predates `assetUrl`, has no such method at all and lands in the same branch.
 * Both keep exactly the behaviour they had before.
 */
function useArtifactSource(path: string | null): ArtifactSource {
  const direct = path === null ? null : omgDirectUrl(path);
  // Deferred (`path === null`) or blob-only: this stays "loading" until asked.
  const blob = useArtifactBlobUrl(direct === null ? path : null);
  return direct === null ? blob : { status: "direct", value: direct };
}

/**
 * Direct URLs that have already painted once on this page.
 *
 * Strings only. No object URL is created for them, so nothing here can be
 * revoked out from under a row that is still on screen — the failure mode that
 * makes reference-counted blob caches worse than the flicker they fix. It
 * exists so a row scrolling back into view starts at the picture instead of at
 * the skeleton. It grows with the number of distinct artifacts a page has
 * shown, which is a few short strings each.
 */
const paintedArtifactUrls = new Set<string>();

function ArtifactLoadError({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-28 min-w-40 items-center justify-center bg-muted/35 px-4 text-center text-xs text-muted-foreground",
        className,
      )}
    >
      Artifact couldn’t load.
    </div>
  );
}

function ArtifactLoading({
  className,
  width,
  height,
}: {
  className?: string;
  width?: number;
  height?: number;
}) {
  const hasDimensions = !!width && !!height;
  return (
    <div
      aria-hidden
      // Match the final image's exact intrinsic box. The transcript can lay out
      // the card before authenticated preview bytes arrive, eliminating the
      // old 160x112 placeholder -> image jump.
      style={hasDimensions ? {
        aspectRatio: `${width} / ${height}`,
        width: `min(${width}px, calc(24rem * ${width / height}))`,
      } : undefined}
      className={cn(
        "animate-pulse bg-muted/35",
        !hasDimensions && "min-h-28 min-w-40",
        className,
      )}
    />
  );
}

/**
 * One image, from either source.
 *
 * On the blob path the states are the same three as before: skeleton, image,
 * error box. On the direct path the `<img>` itself is the loader, so it has to
 * be in the tree before anyone knows whether the bytes arrive, and its
 * `onLoad`/`onError` supply the same two states. The placeholder is then a
 * background on that one element rather than a second element: the box is
 * already reserved by `width`/`height`, so there is no swap and no layout jump.
 */
function ArtifactPicture({
  source,
  alt,
  width,
  height,
  lazy = false,
  onClick,
  fallback,
  className,
}: {
  source: ArtifactSource;
  alt: string;
  width?: number;
  height?: number;
  /** Defer off-screen bytes. Only for images a caller expects below the fold. */
  lazy?: boolean;
  onClick?: () => void;
  fallback?: ReactNode;
  className?: string;
}) {
  const direct = source.status === "direct" ? source.value : null;
  // Seeded from the set, so a re-mounted row skips the skeleton for a picture
  // the browser has already painted once.
  const [painted, setPainted] = useState(
    () => direct !== null && paintedArtifactUrls.has(direct),
  );
  const [directFailed, setDirectFailed] = useState(false);

  useEffect(() => {
    if (direct === null) return;
    setPainted(paintedArtifactUrls.has(direct));
    setDirectFailed(false);
  }, [direct]);

  if (source.status === "error" || directFailed) {
    return <>{fallback ?? <ArtifactLoadError className={className} />}</>;
  }
  if (source.status === "loading") {
    return <ArtifactLoading className={className} width={width} height={height} />;
  }
  return (
    <img
      src={source.value}
      alt={alt}
      width={width}
      height={height}
      loading={lazy ? "lazy" : undefined}
      decoding={lazy ? "async" : undefined}
      onClick={onClick}
      onLoad={
        direct === null
          ? undefined
          : () => {
              paintedArtifactUrls.add(direct);
              setPainted(true);
            }
      }
      onError={direct === null ? undefined : () => setDirectFailed(true)}
      className={cn(
        onClick && "cursor-zoom-in",
        className,
        // Last, so it wins over any background the caller asked for while the
        // bytes are still in flight.
        direct !== null && !painted && "animate-pulse bg-muted/35",
      )}
    />
  );
}

/**
 * A zoomable authenticated image that does NOT download the original to show a
 * thumbnail.
 *
 * `ZoomableImage` appends `?preview=1` to get the server's bounded WebP, but it
 * has to skip that for `blob:` URLs — and every authenticated image was a blob,
 * because the bytes arrived through the transport rather than the `<img>`
 * element. So the feed was rendering 176px tiles out of full-size originals (up
 * to 25 MB each, several per post). Fetch the preview for the tile and the
 * original only once someone actually zooms in.
 */
function AuthenticatedZoomableImage({
  path,
  alt,
  width,
  height,
  fallback,
  className,
}: {
  path: string;
  alt: string;
  width?: number;
  height?: number;
  fallback?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const preview = useArtifactSource(artifactRequestPath(path, { preview: 1 }));
  // Still gated on `open`. A direct URL is only a string, and the lightbox
  // renders no element while closed, so the original is requested on zoom
  // either way.
  const full = useArtifactSource(open ? path : null);
  // Falls back to the preview until the original arrives, so opening the
  // lightbox never shows an empty frame.
  const fullSrc = full.value ?? preview.value;

  return (
    <>
      <ArtifactPicture
        source={preview}
        alt={alt}
        width={width}
        height={height}
        lazy
        onClick={() => setOpen(true)}
        fallback={fallback}
        className={className}
      />
      {fullSrc === null ? null : (
        <ImageLightbox
          src={fullSrc}
          alt={alt}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function AuthenticatedArtifactImage({
  path,
  alt,
  width,
  height,
  zoomable = false,
  thumb = false,
  fallback,
  className,
}: {
  path: string;
  alt: string;
  width?: number;
  height?: number;
  zoomable?: boolean;
  /** Shown instead of the generic error box when the bytes can't be fetched —
   *  user uploads live in tmpdir, so an old transcript's images may be gone. */
  fallback?: ReactNode;
  /** Fetch the server's 160px webp instead of the original. For small fixed
   *  squares (the Notification Center's media thumbnails) where downloading a
   *  multi-megabyte original to paint 52px is pure waste. */
  thumb?: boolean;
  className?: string;
}) {
  if (zoomable) {
    return (
      <AuthenticatedZoomableImage
        path={path}
        alt={alt}
        width={width}
        height={height}
        fallback={fallback}
        className={className}
      />
    );
  }
  return (
    <AuthenticatedPlainImage
      path={path}
      alt={alt}
      thumb={thumb}
      fallback={fallback}
      className={className}
    />
  );
}

function AuthenticatedPlainImage({
  path,
  alt,
  thumb = false,
  fallback,
  className,
}: {
  path: string;
  alt: string;
  thumb?: boolean;
  fallback?: ReactNode;
  className?: string;
}) {
  const source = useArtifactSource(
    thumb ? artifactRequestPath(path, { preview: "thumb" }) : path,
  );
  return (
    <ArtifactPicture
      source={source}
      alt={alt}
      fallback={fallback}
      className={className}
    />
  );
}

/**
 * Authenticated video.
 *
 * On the blob path `preload="metadata"` would be a lie: the bytes arrive
 * through the transport as one blob, so by the time the `<video>` exists the
 * whole file is already in memory. On the Shipped feed that meant one 2 MB clip
 * was downloaded just to paint a thumbnail nobody had pressed play on — more
 * than every image on the page combined. So unless the caller actually wants
 * playback now (`autoPlay`, i.e. the full-page viewer), wait for the tap. A
 * direct URL keeps that gate and adds real streaming: the element requests byte
 * ranges, which the server already serves.
 */
export function AuthenticatedArtifactVideo({
  path,
  label,
  controls = true,
  autoPlay = false,
  className,
}: {
  path: string;
  label?: string;
  controls?: boolean;
  autoPlay?: boolean;
  className?: string;
}) {
  const [requested, setRequested] = useState(autoPlay);
  const source = useArtifactSource(requested ? path : null);
  const direct = source.status === "direct" ? source.value : null;
  const [directFailed, setDirectFailed] = useState(false);

  useEffect(() => {
    if (direct === null) return;
    setDirectFailed(false);
  }, [direct]);

  if (!requested) {
    return (
      <button
        type="button"
        onClick={() => setRequested(true)}
        aria-label={label ? `Play ${label}` : "Play video"}
        className={cn(
          "group relative flex items-center justify-center bg-black/90",
          className,
        )}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-white/15 backdrop-blur transition-transform group-hover:scale-105 group-active:scale-95">
          {/* Inline so this component keeps no icon-library dependency. */}
          <svg viewBox="0 0 24 24" aria-hidden className="size-5 translate-x-[1px] fill-white">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </button>
    );
  }
  if (source.status === "error" || directFailed) {
    return <ArtifactLoadError className={className} />;
  }
  if (source.status === "loading") {
    return <ArtifactLoading className={className} />;
  }
  return (
    <video
      src={source.value}
      controls={controls}
      // Requested by an explicit tap, so start playing rather than making the
      // user press play a second time.
      autoPlay
      playsInline
      aria-label={label}
      onError={direct === null ? undefined : () => setDirectFailed(true)}
      className={className}
    />
  );
}
