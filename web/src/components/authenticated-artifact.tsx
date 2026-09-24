import { useEffect, useRef, useState, type ReactNode } from "react";

import { artifactRequestPath } from "../lib/artifact-document";
import { omgDirectUrl, omgFetch, resolveOmgDirectUrl } from "../lib/omg-client";
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
 * `assetUrl` returns null there. A current host can resolve a signed artifact
 * URL asynchronously. An older host has no resolver and keeps the blob path.
 */
function useArtifactSource(path: string | null, generation = 0): ArtifactSource {
  const direct = path === null ? null : omgDirectUrl(path);
  type Resolution =
    | { path: string | null; generation: number; status: "loading"; value: null }
    | { path: string; generation: number; status: "direct"; value: string }
    | { path: string; generation: number; status: "blob"; value: null };
  const [resolution, setResolution] = useState<Resolution>({
    path: null,
    generation: 0,
    status: "loading",
    value: null,
  });

  useEffect(() => {
    if (path === null || direct !== null) return;
    let active = true;
    void resolveOmgDirectUrl(path).then((value) => {
      if (!active) return;
      setResolution(
        value === null
          ? { path, generation, status: "blob", value: null }
          : { path, generation, status: "direct", value },
      );
    });
    return () => {
      active = false;
    };
  }, [direct, path, generation]);

  // Do not expose the previous path while a virtualized row is reused, nor
  // the previous (expired) URL while a renewal resolves.
  const current =
    resolution.path === path && resolution.generation === generation ? resolution : null;
  const blob = useArtifactBlobUrl(
    direct === null && current?.status === "blob" ? path : null,
  );
  if (direct !== null) return { status: "direct", value: direct };
  if (current?.status === "direct") {
    return { status: "direct", value: current.value };
  }
  return current?.status === "blob" ? blob : { status: "loading", value: null };
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

/**
 * The `max-h-[24rem]` every transcript media caller passes in its className.
 * Reserving the box means solving for the height that cap produces, so the
 * number has to exist on this side too. Keep the two in step.
 */
const MEDIA_MAX_HEIGHT_CSS = "24rem";

/**
 * The exact box a `w-auto max-w-full max-h-[24rem] object-contain` image will
 * occupy once it has decoded, from its intrinsic dimensions alone.
 *
 * WITHOUT THIS AN UNDECODED IMAGE IS ZERO PIXELS TALL, AND THAT IS A LAYOUT
 * BUG, NOT A COSMETIC ONE. `width`/`height` on an `<img>` are only
 * PRESENTATIONAL hints, and any author `width` rule beats them — including
 * Tailwind's `w-auto`. So `w-auto` resolves against the intrinsic width, which
 * for an image that has not decoded yet is 0, which makes `aspect-ratio`
 * resolve a height of 0 as well. Measured directly in the browser on the
 * transcript's own class list, with a src that never resolves:
 *
 *   w-auto max-w-full max-h-[24rem]            ->   0px   (computed width 0px)
 *   the same, minus w-auto                     -> 384px   (width 340px)
 *   the same, plus the style below             -> 384px   (width 307px)
 *
 * Dropping `w-auto` is not the fix: the width then comes from the attribute
 * clamped by `max-w-full`, so the image letterboxes inside a `w-fit` card and
 * gains empty bands beside it. A definite width solves to the same 307px the
 * decoded image settles at, so nothing moves when the bytes land.
 */
export function reservedMediaBox(
  width: number | undefined,
  height: number | undefined,
): { aspectRatio: string; width: string } | undefined {
  if (!width || !height) return undefined;
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(${width}px, calc(${MEDIA_MAX_HEIGHT_CSS} * ${width / height}))`,
  };
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
  const reserved = reservedMediaBox(width, height);
  return (
    <div
      aria-hidden
      // Match the final image's exact intrinsic box. The transcript can lay out
      // the card before authenticated preview bytes arrive, eliminating the
      // old 160x112 placeholder -> image jump.
      style={reserved}
      className={cn(
        "animate-pulse bg-muted/35",
        !reserved && "min-h-28 min-w-40",
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
 * background on that one element rather than a second element.
 *
 * That last part used to claim the box was "already reserved by
 * `width`/`height`". It was not — see `reservedMediaBox`, which is what
 * actually reserves it. Until it did, an undecoded transcript image was zero
 * pixels tall and the row around it grew by the image's full height the moment
 * the bytes landed, which in a virtualized transcript printed the NEXT row
 * inside this one.
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
      // Hold the decoded image's exact box from the first frame. The attributes
      // above cannot do it on their own: they are presentational hints, and the
      // caller's `w-auto` outranks them.
      style={reservedMediaBox(width, height)}
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
 * The play glyph that sits over a poster. Inline so this file keeps no
 * icon-library dependency.
 */
function PlayGlyph() {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-black/55 backdrop-blur transition-transform group-hover:scale-105 group-active:scale-95">
        <svg viewBox="0 0 24 24" aria-hidden className="size-5 translate-x-[1px] fill-white">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </span>
  );
}

/**
 * Authenticated video.
 *
 * Nothing about the video itself is requested until the user taps. On the blob
 * path `preload="metadata"` would be a lie: the bytes arrive through the
 * transport as one blob, so by the time the `<video>` exists the whole file is
 * already in memory. On the Shipped feed that meant one 2 MB clip was
 * downloaded just to paint a thumbnail nobody had pressed play on. A direct
 * URL keeps the gate and adds real streaming: the element requests byte
 * ranges, which the server already serves.
 *
 * What IS shown before the tap is the server's poster frame (`?preview=1` on
 * a video artifact), inside the box the player will occupy. That box comes
 * from `width`/`height`, recorded when the artifact is published. Without it
 * the untapped state was a 44px play button with nothing around it, and the
 * caption, which wraps to the media's width, came down one word per line.
 */
/** Consecutive re-signs before a video error is shown as final. */
const MAX_VIDEO_RENEWALS = 2;

export function AuthenticatedArtifactVideo({
  path,
  label,
  width,
  height,
  controls = true,
  autoPlay = false,
  className,
}: {
  path: string;
  label?: string;
  width?: number;
  height?: number;
  controls?: boolean;
  autoPlay?: boolean;
  className?: string;
}) {
  const [requested, setRequested] = useState(autoPlay);
  // A hosted transport signs the URL with a grant that lives ten minutes, and
  // the element keeps requesting ranges from that URL as it plays and seeks.
  // Once the grant expires those requests get 401 and playback stops. So an
  // error re-signs the URL and resumes at the same time, at most
  // MAX_VIDEO_RENEWALS times in a row; playing again resets the count. A
  // same-origin URL carries no grant, so its error is final at once.
  const [generation, setGeneration] = useState(0);
  const failures = useRef(0);
  const resumeAt = useRef<number | null>(null);
  const renewable = requested && omgDirectUrl(path) === null;
  const source = useArtifactSource(requested ? path : null, generation);
  // The full-page viewer plays at once, so it never needs the still.
  const poster = useArtifactSource(autoPlay ? null : artifactRequestPath(path, { preview: 1 }));
  const direct = source.status === "direct" ? source.value : null;
  const [directFailed, setDirectFailed] = useState(false);

  useEffect(() => {
    if (direct === null) return;
    setDirectFailed(false);
  }, [direct]);

  const reserved = reservedMediaBox(width, height);
  // The still, or an empty dark box of the same shape when there is none (a
  // box without ffmpeg, or an artifact published before posters existed).
  const still = (
    <ArtifactPicture
      source={poster}
      alt={label ?? "Video"}
      width={width}
      height={height}
      lazy
      fallback={
        <div
          aria-hidden
          style={reserved}
          className={cn("bg-black", !reserved && "aspect-video w-72 max-w-full", className)}
        />
      }
      className={className}
    />
  );

  if (!requested) {
    return (
      <button
        type="button"
        onClick={() => setRequested(true)}
        aria-label={label ? `Play ${label}` : "Play video"}
        className="group relative block w-fit max-w-full cursor-pointer"
      >
        {still}
        <PlayGlyph />
      </button>
    );
  }
  if (source.status === "error" || directFailed) {
    return <ArtifactLoadError className={className} />;
  }
  if (source.status === "loading") {
    // The bytes are on their way through the transport. Keep the still on
    // screen, dimmed, so the row does not change shape while it waits.
    return (
      <div role="status" aria-label="Loading video" className="relative w-fit max-w-full animate-pulse">
        {still}
      </div>
    );
  }
  return (
    <video
      src={source.value}
      poster={poster.value ?? undefined}
      controls={controls}
      // Requested by an explicit tap, so start playing rather than making the
      // user press play a second time.
      autoPlay
      playsInline
      aria-label={label}
      // Same box as the still it replaces, so nothing moves on the tap.
      style={reserved}
      key={generation}
      onError={
        direct === null
          ? undefined
          : (event) => {
              if (renewable && failures.current < MAX_VIDEO_RENEWALS) {
                failures.current += 1;
                resumeAt.current = event.currentTarget.currentTime;
                setGeneration((g) => g + 1);
                return;
              }
              setDirectFailed(true);
            }
      }
      onLoadedMetadata={(event) => {
        if (resumeAt.current === null) return;
        event.currentTarget.currentTime = resumeAt.current;
        resumeAt.current = null;
      }}
      onPlaying={() => {
        failures.current = 0;
      }}
      className={className}
    />
  );
}
