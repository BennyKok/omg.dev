// Render-level guard for the general "file" artifact card.
//
// Two regressions this exists to catch:
//
//   - A displayed file falling through to the prose renderer, so an agent that
//     meant to hand you a PDF hands you a grey sentence about a PDF. That is
//     the bug the mobile transcript actually had.
//   - The card fetching the file's bytes just to draw itself. A file artifact
//     can be 100 MB, and a transcript can hold several.
//
// Both are only visible at the DOM, which is why this mounts the component
// rather than reading its source.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { OmgTransport } from "@omg-dev/client";

import { mount, type Mounted } from "../test-support/render";

const { createSameOriginTransport } = await import("@omg-dev/client");
const { configureOmgTransport } = await import("../lib/omg-client");
const { ArtifactFileCard, downloadProgressLabel, formatFileSize } = await import("./artifact-file-card");

let ui: Mounted;
let fetched: string[];

function installTransport(options: { direct: boolean }) {
  const transport: OmgTransport = {
    async fetch(path: string) {
      fetched.push(path);
      return new Response(new Blob(["bytes"], { type: "application/octet-stream" }));
    },
    async request() {
      throw new Error("request is not used by the file card");
    },
    async openSocket() {
      throw new Error("socket is not used by the file card");
    },
    async openLiveSocket() {
      throw new Error("socket is not used by the file card");
    },
    ...(options.direct ? { assetUrl: (path: string) => path } : {}),
  };
  configureOmgTransport(transport);
}

beforeEach(() => {
  fetched = [];
  ui = mount();
  installTransport({ direct: true });
});

afterEach(() => {
  ui.cleanup();
  configureOmgTransport(createSameOriginTransport());
});

describe("ArtifactFileCard", () => {
  test("names a file and offers a download instead of dropping it into prose", async () => {
    await ui.flushAsync(() => {
      ui.render(
        <ArtifactFileCard
          url="/api/artifacts/a1"
          name="q3-report.pdf"
          mimeType="application/pdf"
          size={2048}
          caption="Q3 report"
        />,
      );
    });

    expect(ui.text()).toContain("q3-report.pdf");
    expect(ui.text()).toContain("2 KB");
    expect(ui.text()).toContain("Q3 report");
    const link = ui.query("a[download]") as HTMLAnchorElement | null;
    expect(link?.getAttribute("href")).toBe("/api/artifacts/a1");
    expect(link?.getAttribute("download")).toBe("q3-report.pdf");
    // The name is the click target, not only a 16px icon beside it.
    expect(link?.textContent).toContain("q3-report.pdf");
  });

  // The card is deliberately not a viewer. An embed would mean handing
  // agent-chosen bytes to the browser to interpret on this origin.
  test.each([
    ["application/pdf", "spec.pdf"],
    ["audio/mpeg", "note.mp3"],
    ["text/csv; charset=utf-8", "rows.csv"],
    ["application/octet-stream", "archive.zip"],
  ])("renders %s as a download card with no embedded viewer", async (mimeType, name) => {
    await ui.flushAsync(() => {
      ui.render(<ArtifactFileCard url="/api/artifacts/a2" name={name} mimeType={mimeType} />);
    });

    expect(ui.query("object")).toBeNull();
    expect(ui.query("iframe")).toBeNull();
    expect(ui.query("embed")).toBeNull();
    expect(ui.query("audio")).toBeNull();
    expect(ui.query("video")).toBeNull();
    expect(ui.text()).toContain(name);
  });

  test("downloads nothing to draw the card on either transport", async () => {
    await ui.flushAsync(() => {
      ui.render(
        <ArtifactFileCard url="/api/artifacts/a3" name="big.zip" mimeType="application/zip" />,
      );
    });
    expect(fetched).toEqual([]);

    installTransport({ direct: false });
    ui.remount();
    await ui.flushAsync(() => {
      ui.render(
        <ArtifactFileCard url="/api/artifacts/a4" name="big.zip" mimeType="application/zip" />,
      );
    });
    // No anchor to preload: the bytes are fetched by the click handler.
    expect(fetched).toEqual([]);
    expect(ui.query("a[download]")).toBeNull();
    expect(ui.query("button")).not.toBeNull();
  });

  test("fetches the bytes when a signed-transport download is clicked", async () => {
    // The component saves the blob by clicking a synthetic <a download>. A real
    // browser honours `download` and stays put; happy-dom instead NAVIGATES the
    // shared window to the blob URL, which silently breaks every test file that
    // runs after this one. Intercept the click: it keeps the environment clean
    // and lets us assert what the anchor was actually given.
    const anchorProto = (globalThis as unknown as {
      window: { HTMLAnchorElement: { prototype: HTMLAnchorElement } };
    }).window.HTMLAnchorElement.prototype;
    const realClick = anchorProto.click;
    const clicked: Array<{ href: string; download: string }> = [];
    anchorProto.click = function patched(this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute("href") ?? "", download: this.download });
    };

    try {
      installTransport({ direct: false });
      await ui.flushAsync(() => {
        ui.render(
          <ArtifactFileCard url="/api/artifacts/a5" name="clip.wav" mimeType="audio/wav" />,
        );
      });

      await ui.flushAsync(async () => {
        (ui.query("button") as HTMLButtonElement).click();
        // onClick is fire-and-forget, so `click()` returns before the fetch
        // chain finishes. Settle it INSIDE act, or its final setState lands in
        // a later test's act block and breaks that test instead of this one.
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(fetched).toEqual(["/api/artifacts/a5"]);
      expect(clicked.length).toBe(1);
      expect(clicked[0].href).toStartWith("blob:");
      expect(clicked[0].download).toBe("clip.wav");
      // Settled, not still in flight.
      expect((ui.query("button") as HTMLButtonElement).disabled).toBe(false);
    } finally {
      anchorProto.click = realClick;
    }
  });

  test("reports progress while a signed-transport download is in flight", async () => {
    const anchorProto = (globalThis as unknown as {
      window: { HTMLAnchorElement: { prototype: HTMLAnchorElement } };
    }).window.HTMLAnchorElement.prototype;
    const realClick = anchorProto.click;
    anchorProto.click = function patched() {};

    let push!: (chunk: Uint8Array | null) => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => (chunk ? controller.enqueue(chunk) : controller.close());
      },
    });
    configureOmgTransport({
      async fetch() {
        return new Response(body, {
          headers: { "content-length": "10", "content-type": "application/octet-stream" },
        });
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
    });

    try {
      await ui.flushAsync(() => {
        ui.render(<ArtifactFileCard url="/api/artifacts/a8" name="big.bin" size={10} />);
      });
      await ui.flushAsync(async () => {
        (ui.query("button") as HTMLButtonElement).click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        push(new Uint8Array(5));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(ui.query('[data-slot="file-status"]')?.textContent).toBe("50%");
      expect((ui.query("button") as HTMLButtonElement).disabled).toBe(true);

      await ui.flushAsync(async () => {
        push(new Uint8Array(5));
        push(null);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      // Back to the resting size once the save has been handed to the browser.
      expect(ui.query('[data-slot="file-status"]')?.textContent).toBe("10 B");
      expect((ui.query("button") as HTMLButtonElement).disabled).toBe(false);
    } finally {
      anchorProto.click = realClick;
    }
  });

  test("says so when a signed-transport download fails, and lets the click retry", async () => {
    configureOmgTransport({
      async fetch() {
        return new Response("nope", { status: 502 });
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
    });
    await ui.flushAsync(() => {
      ui.render(<ArtifactFileCard url="/api/artifacts/a9" name="big.bin" size={10} />);
    });
    await ui.flushAsync(async () => {
      (ui.query("button") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(ui.query('[data-slot="file-status"]')?.textContent).toBe("Download failed. Click to retry.");
    expect((ui.query("button") as HTMLButtonElement).disabled).toBe(false);
  });

  test("does not repeat the caption when it is the same as the file name", async () => {
    await ui.flushAsync(() => {
      ui.render(
        <ArtifactFileCard
          url="/api/artifacts/a6"
          name="rows.csv"
          mimeType="text/csv; charset=utf-8"
          caption="rows.csv"
        />,
      );
    });

    expect(ui.query('[data-slot="file-caption"]')).toBeNull();
  });

  test("shows a caption that says something the file name does not", async () => {
    await ui.flushAsync(() => {
      ui.render(
        <ArtifactFileCard
          url="/api/artifacts/a7"
          name="rows.csv"
          mimeType="text/csv; charset=utf-8"
          caption="Every signup in August"
        />,
      );
    });

    expect(ui.query('[data-slot="file-caption"]')?.textContent).toBe("Every signup in August");
  });
});

describe("downloadProgressLabel", () => {
  test("is a percentage with a known total and a byte count without one", () => {
    expect(downloadProgressLabel(5, 10)).toBe("50%");
    // Never claims 100% before the save has actually happened.
    expect(downloadProgressLabel(10, 10)).toBe("99%");
    expect(downloadProgressLabel(2048, 0)).toBe("2 KB");
  });
});

describe("formatFileSize", () => {
  test("reports bytes, KB, MB, and GB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1048576)).toBe("1.0 MB");
    expect(formatFileSize(1073741824)).toBe("1.0 GB");
  });
});
