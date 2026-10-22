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
function installTransport(options: { direct: boolean; resolved?: boolean }) {
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
    ...(options.resolved
      ? {
          resolveAssetUrl: async (path: string) =>
            `https://sessions.example${path}${path.includes("?") ? "&" : "?"}__omg_grant=signed`,
        }
      : {}),
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

  // Opening an image used to put the original straight into the viewer, which
  // stayed empty until a multi-megabyte file had downloaded. The viewer must
  // show the preview that is already painted, and swap only once the original
  // has loaded.
  test("the viewer shows the preview at once and swaps in the original once it loads", async () => {
    installTransport({ direct: true });
    render(
      <AuthenticatedArtifactImage
        path="/api/artifacts/open.png"
        alt="open"
        width={3000}
        height={2000}
        zoomable
      />,
    );
    await act(async () => {});
    await act(async () => {
      img()?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    const dialog = () => document.querySelector('[role="dialog"]')!;
    const shown = () => dialog().querySelector("img:not([aria-hidden])");
    const loader = () => dialog().querySelector("img[aria-hidden]");
    expect(shown()?.getAttribute("src")).toBe("/api/artifacts/open.png?preview=1");
    expect(loader()?.getAttribute("src")).toBe("/api/artifacts/open.png");

    await act(async () => {
      loader()?.dispatchEvent(new window.Event("load"));
    });
    expect(shown()?.getAttribute("src")).toBe("/api/artifacts/open.png");
    expect(loader()).toBeNull();
  });

  // On the hosted web the URL carries a grant that rotates every ten minutes,
  // and the browser cache is keyed by the whole URL. Re-signing on each mount
  // gave every row a skeleton frame, and after a rotation a URL the cache had
  // never seen, so every picture downloaded again. A remount must reuse the
  // URL that already painted; only a failed load may sign a new one.
  test("a remount on the hosted web reuses the signed URL, and renews it only on failure", async () => {
    let minted = 0;
    configureOmgTransport({
      async fetch() {
        throw new Error("fetch is not used for a signed image");
      },
      async request() {
        throw new Error("unused");
      },
      async openSocket() {
        throw new Error("unused");
      },
      async openLiveSocket() {
        throw new Error("unused");
      },
      resolveAssetUrl: async (path: string) =>
        `https://sessions.example${path}&__omg_grant=g${++minted}`,
    });
    const media = (
      <AuthenticatedArtifactImage path="/api/artifacts/signed.png" alt="signed" zoomable />
    );
    const signed = (grant: string) =>
      `https://sessions.example/api/artifacts/signed.png?preview=1&__omg_grant=${grant}`;

    render(media);
    await act(async () => {});
    expect(img()?.getAttribute("src")).toBe(signed("g1"));
    await act(async () => {
      img()?.dispatchEvent(new window.Event("load"));
    });

    // The row scrolls away and back, after the grant has rotated.
    act(() => root.unmount());
    root = createRoot(host);
    render(media);
    // Synchronously: no skeleton frame while a signature resolves.
    expect(img()?.getAttribute("src")).toBe(signed("g1"));
    expect(img()?.className).not.toContain("animate-pulse");
    await act(async () => {});
    expect(minted).toBe(1);

    // The cached bytes are gone and the old grant is refused: sign once more.
    await act(async () => {
      img()?.dispatchEvent(new window.Event("error"));
    });
    expect(img()?.getAttribute("src")).toBe(signed("g2"));
    // A fresh URL that also fails is a missing file, not an expired grant.
    await act(async () => {
      img()?.dispatchEvent(new window.Event("error"));
    });
    expect(img()).toBeNull();
    expect(minted).toBe(2);
  });

  // The viewer grows out of the tapped tile and shrinks back into it, and the
  // tile is hidden meanwhile because the viewer IS that picture, moved. If the
  // close motion's end were lost, the tile would stay hidden in the chat; if
  // the viewer unmounted at once, the motion would never be seen.
  test("closing the viewer waits for its motion, then shows the tapped picture again", async () => {
    installTransport({ direct: true });
    const motions: { onfinish: (() => void) | null }[] = [];
    const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
    // Put back exactly what was there. Assigning `undefined` to a method
    // happy-dom never had would leave an own property that other suites see.
    const saved = ["animate", "getAnimations"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(proto, key),
    ] as const);
    proto.animate = () => {
      const motion = { onfinish: null, oncancel: null, cancel() {} };
      motions.push(motion);
      return motion;
    };
    proto.getAnimations = () => [];
    try {
      render(
        <AuthenticatedArtifactImage
          path="/api/artifacts/flight.png"
          alt="flight"
          width={800}
          height={600}
          zoomable
        />,
      );
      await act(async () => {});
      const tile = img()!;
      await act(async () => {
        tile.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
      expect(tile.className).toContain("invisible");

      const close = document.querySelector('button[aria-label="Close"]') as unknown as HTMLElement;
      await act(async () => {
        close.click();
      });
      // The close motion is running: the viewer is still there.
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      await act(async () => {
        for (const motion of motions) motion.onfinish?.();
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(img()?.className).not.toContain("invisible");
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(proto, key, descriptor);
        else delete proto[key];
      }
    }
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
  test("streams an asynchronously signed URL instead of buffering a blob", async () => {
    installTransport({ direct: false, resolved: true });
    render(
      <AuthenticatedArtifactVideo path="/api/artifacts/signed.mp4" label="signed" autoPlay />,
    );
    await act(async () => {});

    expect(host.querySelector("video")?.getAttribute("src")).toBe(
      "https://sessions.example/api/artifacts/signed.mp4?__omg_grant=signed",
    );
    expect(fetched).toEqual([]);
  });

  // The signed URL's grant lives ten minutes and the element keeps using it
  // for every range it asks for. An error re-signs and remounts the player;
  // two failures in a row with no playback between them end in the error.
  test("an expired signed URL is re-signed, and a dead file still ends in an error", async () => {
    let minted = 0;
    configureOmgTransport({
      async fetch() {
        throw new Error("fetch is not used for a signed video");
      },
      async request() {
        throw new Error("unused");
      },
      async openSocket() {
        throw new Error("unused");
      },
      async openLiveSocket() {
        throw new Error("unused");
      },
      resolveAssetUrl: async (path: string) => `https://sessions.example${path}?__omg_grant=g${++minted}`,
    });
    render(<AuthenticatedArtifactVideo path="/api/artifacts/long.mp4" label="long" autoPlay />);
    await act(async () => {});
    const src = () => host.querySelector("video")?.getAttribute("src");
    const fail = () => act(async () => { host.querySelector("video")!.dispatchEvent(new window.Event("error") as unknown as Event); });
    const play = () => act(async () => { host.querySelector("video")!.dispatchEvent(new window.Event("playing") as unknown as Event); });
    expect(src()).toBe("https://sessions.example/api/artifacts/long.mp4?__omg_grant=g1");

    await fail();
    expect(src()).toBe("https://sessions.example/api/artifacts/long.mp4?__omg_grant=g2");
    // Playback resumed: the next expiry gets its own renewals.
    await play();
    await fail();
    expect(src()).toBe("https://sessions.example/api/artifacts/long.mp4?__omg_grant=g3");
    await fail();
    expect(src()).toBe("https://sessions.example/api/artifacts/long.mp4?__omg_grant=g4");
    // Two renewals with no playback in between: the file is really gone.
    await fail();
    expect(host.querySelector("video")).toBeNull();
    expect(minted).toBe(4);
  });

  test("streams a direct URL instead of buffering the whole file as a blob", async () => {
    installTransport({ direct: true });
    render(
      <AuthenticatedArtifactVideo path="/api/artifacts/clip.mp4" label="clip" autoPlay />,
    );
    await act(async () => {});

    expect(host.querySelector("video")?.getAttribute("src")).toBe("/api/artifacts/clip.mp4");
    expect(fetched).toEqual([]);
  });

  test("waits for the tap before it asks for any video bytes", async () => {
    installTransport({ direct: true });
    render(<AuthenticatedArtifactVideo path="/api/artifacts/clip.mp4" label="clip" />);
    await act(async () => {});

    expect(host.querySelector("video")).toBeNull();
    expect(host.querySelector("button")).not.toBeNull();
    // Only the still is asked for, and on the direct path the element asks.
    expect(img()?.getAttribute("src")).toBe("/api/artifacts/clip.mp4?preview=1");
    expect(fetched).toEqual([]);
  });

  // The untapped state used to be a bare 44px play button. The row's caption
  // wraps to the media's width, so it came down one word per line beside a
  // video nobody could size. The poster now occupies the player's box, from
  // the dimensions the server recorded at publish.
  test("the untapped state occupies the player's box", async () => {
    installTransport({ direct: true });
    render(
      <AuthenticatedArtifactVideo
        path="/api/artifacts/clip.mp4"
        label="clip"
        width={1320}
        height={2868}
        className="w-auto max-h-[24rem]"
      />,
    );
    await act(async () => {});

    // happy-dom drops `min()` widths; the aspect half proves the wiring (see
    // the image test above for the same limitation).
    expect(img()?.getAttribute("style") ?? "").toContain("aspect-ratio: 1320 / 2868");
  });

  test("a tap fetches the video and keeps the still as its poster", async () => {
    installTransport({ direct: false });
    render(
      <AuthenticatedArtifactVideo path="/api/artifacts/clip.mp4" label="clip" width={320} height={180} />,
    );
    await act(async () => {});
    expect(fetched).toEqual(["/api/artifacts/clip.mp4?preview=1"]);

    await act(async () => {
      host.querySelector("button")?.click();
    });
    await act(async () => {});

    expect(fetched).toEqual(["/api/artifacts/clip.mp4?preview=1", "/api/artifacts/clip.mp4"]);
    const video = host.querySelector("video");
    expect(video?.getAttribute("src")).toStartWith("blob:");
    expect(video?.getAttribute("poster")).toStartWith("blob:");
    expect(video?.style.aspectRatio).toBe("320 / 180");
  });
});
