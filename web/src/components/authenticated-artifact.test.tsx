// Render-level guard for artifact media.
//
// The bug this covers is a virtualized transcript row that scrolls off screen,
// unmounts, and then re-downloads its picture and re-flashes a skeleton when it
// comes back. That is invisible to a state-only test: what matters is which URL
// reaches the `<img>` element and whether the placeholder is painted a second
// time.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { OmgTransport } from "@omg-dev/client";

const window = new Window({ url: "http://127.0.0.1:5173/" });
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { createSameOriginTransport } = await import("@omg-dev/client");
const { configureOmgTransport } = await import("../lib/omg-client");
const { AuthenticatedArtifactImage, AuthenticatedArtifactVideo, reservedMediaBox } =
  await import("./authenticated-artifact");

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
let fetched: string[];

/** A transport that can fetch bytes, and either offers a direct URL or does not. */
function installTransport(options: { direct: boolean }) {
  const transport: OmgTransport = {
    async fetch(path: string) {
      fetched.push(path);
      return new Response(new Blob(["png-bytes"], { type: "image/png" }));
    },
    async request() {
      throw new Error("request is not used by artifact media");
    },
    async openSocket() {
      throw new Error("socket is not used by artifact media");
    },
    async openLiveSocket() {
      throw new Error("socket is not used by artifact media");
    },
    // Omitted entirely on the fallback side, which is also what an older host
    // hands us: a transport built against a client that predates assetUrl.
    ...(options.direct ? { assetUrl: (path: string) => path } : {}),
  };
  configureOmgTransport(transport);
}

beforeEach(() => {
  fetched = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  configureOmgTransport(createSameOriginTransport());
});

const render = (ui: React.ReactElement) => act(() => root.render(ui));
const img = () => host.querySelector("img");

describe("AuthenticatedArtifactImage", () => {
  test("loads a direct URL in the element and downloads nothing itself", async () => {
    installTransport({ direct: true });
    render(
      <AuthenticatedArtifactImage
        path="/api/artifacts/direct.png"
        alt="direct"
        width={800}
        height={600}
        zoomable
      />,
    );
    await act(async () => {});

    expect(img()?.getAttribute("src")).toBe("/api/artifacts/direct.png?preview=1");
    expect(fetched).toEqual([]);
  });

  test("still fetches a blob when the transport offers no direct URL", async () => {
    installTransport({ direct: false });
    render(
      <AuthenticatedArtifactImage
        path="/api/artifacts/blob.png"
        alt="blob"
        width={800}
        height={600}
        zoomable
      />,
    );
    // Nothing to show until the bytes land: the old skeleton, unchanged.
    expect(img()).toBeNull();
    await act(async () => {});

    expect(fetched).toEqual(["/api/artifacts/blob.png?preview=1"]);
    expect(img()?.getAttribute("src")).toStartWith("blob:");
  });

  // An undecoded image must already occupy the box it will occupy once it has
  // decoded. The `width`/`height` attributes below look like they do that, but
  // they are only presentational hints and the caller's `w-auto` outranks them,
  // so `width` resolved against a 0px intrinsic width and the element was ZERO
  // PIXELS TALL until the bytes arrived. In the virtualized transcript the row
  // was then measured collapsed, everything below it was packed against that
  // measurement, and when the picture landed the row grew by its full height
  // with the next row still sitting inside it — a user bubble printed over the
  // tail of the reply above it. Measured in a real browser on the transcript's
  // own class list, with a src that never resolves: 0px with `w-auto`, 384px
  // once an explicit width is present.
  test("an image reserves its decoded box before the bytes arrive", async () => {
    installTransport({ direct: true });
    render(
      <AuthenticatedArtifactImage
        path="/api/artifacts/reserved.png"
        alt="reserved"
        width={600}
        height={750}
        zoomable
        className="w-auto max-h-[24rem]"
      />,
    );
    await act(async () => {});

    // happy-dom's CSS parser drops `min()`/`calc()` values, so the width half
    // of the reservation cannot be read back off the element here — it is
    // asserted directly on `reservedMediaBox` below. What this proves is the
    // WIRING: the style reaches the element at all, before any bytes arrive.
    expect(img()?.getAttribute("style") ?? "").toContain("aspect-ratio: 600 / 750");
  });

  test("the reserved box solves to the size the decoded image settles at", () => {
    // 600x750 inside `max-h-[24rem]`: the height cap binds first, so the width
    // is 384 * (600/750) = 307.2px — which is what the decoded image measures
    // in the transcript. A DEFINITE width is the part `w-auto` was destroying;
    // without it the ratio has nothing to resolve against and the height is 0.
    expect(reservedMediaBox(600, 750)).toEqual({
      aspectRatio: "600 / 750",
      width: "min(600px, calc(24rem * 0.8))",
    });
    // Unknown dimensions reserve nothing rather than guessing a wrong box.
    expect(reservedMediaBox(undefined, 750)).toBeUndefined();
    expect(reservedMediaBox(600, 0)).toBeUndefined();
  });

  test("an image with unknown dimensions reserves nothing and still renders", async () => {
    installTransport({ direct: true });
    render(
      <AuthenticatedArtifactImage path="/api/artifacts/nodims.png" alt="nodims" zoomable />,
    );
    await act(async () => {});

    expect(img()).not.toBeNull();
    expect(img()?.getAttribute("style") ?? "").not.toContain("aspect-ratio");
  });

  test("thumbnails and plain images take the same route", async () => {
    installTransport({ direct: true });
    render(
      <AuthenticatedArtifactImage path="/api/artifacts/thumb.png" alt="thumb" thumb />,
    );
    await act(async () => {});

    expect(img()?.getAttribute("src")).toBe("/api/artifacts/thumb.png?preview=thumb");
    expect(fetched).toEqual([]);
  });

  test("a row that scrolls back into view shows the picture, not the skeleton", async () => {
    installTransport({ direct: true });
    const media = (
      <AuthenticatedArtifactImage
        path="/api/artifacts/scrolled.png"
        alt="scrolled"
        width={800}
        height={600}
        zoomable
      />
    );

    render(media);
    // First sight of these bytes: the element carries the placeholder.
    expect(img()?.className).toContain("animate-pulse");
    await act(async () => {
      img()?.dispatchEvent(new window.Event("load"));
    });
    expect(img()?.className).not.toContain("animate-pulse");

    // The row leaves the viewport and comes back.
    act(() => root.unmount());
    root = createRoot(host);
    render(media);

    expect(img()?.getAttribute("src")).toBe("/api/artifacts/scrolled.png?preview=1");
    expect(img()?.className).not.toContain("animate-pulse");
    expect(fetched).toEqual([]);
  });

  test("zooming loads the original, and only on zoom", async () => {
    installTransport({ direct: true });
    render(
      <AuthenticatedArtifactImage
        path="/api/artifacts/zoom.png"
        alt="zoom"
        width={800}
        height={600}
        zoomable
      />,
    );
    await act(async () => {});
    // The tile shows the server's bounded preview. Nothing has asked for the
    // original yet: the lightbox renders no element while it is closed.
    expect(document.querySelectorAll("img")).toHaveLength(1);

    await act(async () => {
      img()?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    const sources = [...document.querySelectorAll("img")].map((el) => el.getAttribute("src"));
    expect(sources).toContain("/api/artifacts/zoom.png");
    expect(fetched).toEqual([]);
  });

  test("a direct URL that fails falls back to the caller's placeholder", async () => {
    installTransport({ direct: true });
    render(
      <AuthenticatedArtifactImage
        path="/api/artifacts/gone.png"
        alt="gone"
        zoomable
        fallback={<span>file is gone</span>}
      />,
    );
    await act(async () => {
      img()?.dispatchEvent(new window.Event("error"));
    });

    expect(img()).toBeNull();
    expect(host.textContent).toContain("file is gone");
  });
});

describe("AuthenticatedArtifactVideo", () => {
  test("streams a direct URL instead of buffering the whole file as a blob", async () => {
    installTransport({ direct: true });
    render(
      <AuthenticatedArtifactVideo path="/api/artifacts/clip.mp4" label="clip" autoPlay />,
    );
    await act(async () => {});

    expect(host.querySelector("video")?.getAttribute("src")).toBe("/api/artifacts/clip.mp4");
    expect(fetched).toEqual([]);
  });

  test("waits for the tap before it asks for any bytes", async () => {
    installTransport({ direct: true });
    render(<AuthenticatedArtifactVideo path="/api/artifacts/clip.mp4" label="clip" />);
    await act(async () => {});

    expect(host.querySelector("video")).toBeNull();
    expect(host.querySelector("button")).not.toBeNull();
  });
});
