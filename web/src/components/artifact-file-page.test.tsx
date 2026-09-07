// The file page: what it previews, when it asks first, and that a type it
// cannot show as text never has its bytes requested. Rendered, not read.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { OmgTransport } from "@omg-dev/client";

import { mount, type Mounted } from "../test-support/render";

const { createSameOriginTransport } = await import("@omg-dev/client");
const { configureOmgTransport } = await import("../lib/omg-client");
const {
  ArtifactFilePage,
  AUTO_PREVIEW_BYTES,
  MAX_PREVIEW_BYTES,
  PREVIEW_BYTES,
  looksBinary,
  parseDelimited,
  previewPolicy,
} = await import("./artifact-file-page");

let ui: Mounted;
let fetched: Array<{ path: string; range: string | null }>;

function install(body: () => BodyInit, headers: Record<string, string> = {}) {
  const transport: OmgTransport = {
    async fetch(path: string, init?: RequestInit) {
      fetched.push({ path, range: new Headers(init?.headers).get("range") });
      return new Response(body(), { headers });
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
    assetUrl: (path: string) => path,
  };
  configureOmgTransport(transport);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fetched = [];
  ui = mount();
  install(() => "hello");
});

afterEach(() => {
  ui.cleanup();
  configureOmgTransport(createSameOriginTransport());
});

describe("previewPolicy", () => {
  test("small text previews on open, large text asks, the rest has no preview", () => {
    expect(previewPolicy({ name: "rows.csv", mimeType: "text/csv; charset=utf-8", size: 900 })).toBe("auto");
    expect(previewPolicy({ name: "app.log", size: AUTO_PREVIEW_BYTES })).toBe("auto");
    expect(previewPolicy({ name: "app.log", size: AUTO_PREVIEW_BYTES + 1 })).toBe("ask");
    expect(previewPolicy({ name: "dump.sql", size: MAX_PREVIEW_BYTES + 1 })).toBe("none");
    expect(previewPolicy({ name: "site.zip", mimeType: "application/zip", size: 10 })).toBe("none");
    expect(previewPolicy({ name: "spec.pdf", mimeType: "application/pdf", size: 10 })).toBe("none");
    // The general kind types unknown extensions as octet-stream; the name decides.
    expect(previewPolicy({ name: "main.rs", mimeType: "application/octet-stream", size: 10 })).toBe("auto");
    expect(previewPolicy({ name: "blob", mimeType: "application/octet-stream", size: 10 })).toBe("none");
  });
});

describe("parseDelimited", () => {
  test("handles quotes, doubled quotes, CRLF, and the row cap", () => {
    expect(parseDelimited('a,b\r\n1,"x, y"\n2,"say ""hi"""\n', ",", 10)).toEqual([
      ["a", "b"],
      ["1", "x, y"],
      ["2", 'say "hi"'],
    ]);
    expect(parseDelimited("a\tb\n1\t2\n3\t4\n", "\t", 2)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

test("looksBinary finds a NUL in the head", () => {
  expect(looksBinary(new TextEncoder().encode("plain text"))).toBe(false);
  expect(looksBinary(new Uint8Array([80, 75, 3, 4, 0, 0]))).toBe(true);
});

describe("ArtifactFilePage", () => {
  test("shows a small CSV as a table without being asked", async () => {
    install(() => "name,count\nalice,3\nbob,5\n", { "content-type": "text/csv" });
    await ui.flushAsync(async () => {
      ui.render(
        <ArtifactFilePage url="/api/artifacts/c1" name="rows.csv" mimeType="text/csv; charset=utf-8" size={28} />,
      );
      await settle();
    });
    expect(fetched).toEqual([{ path: "/api/artifacts/c1", range: null }]);
    const table = ui.query('[data-slot="delimited-preview"]');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("th").length).toBe(2);
    expect(table?.querySelectorAll("tbody tr").length).toBe(2);
    expect(ui.text()).toContain("alice");
    // The download is always there, and it names the file.
    const link = ui.query("a[download]") as HTMLAnchorElement | null;
    expect(link?.getAttribute("href")).toBe("/api/artifacts/c1");
    expect(link?.getAttribute("download")).toBe("rows.csv");
  });

  test("asks before previewing a large text file, then requests only the head", async () => {
    const size = AUTO_PREVIEW_BYTES * 3;
    install(() => "x".repeat(16), { "content-type": "text/plain" });
    await ui.flushAsync(async () => {
      ui.render(<ArtifactFilePage url="/api/artifacts/c2" name="big.log" mimeType="text/plain" size={size} />);
      await settle();
    });
    // Nothing loaded on open; the user was asked.
    expect(fetched).toEqual([]);
    expect(ui.text()).toContain("3.0 MB");
    const ask = ui.query('[data-slot="preview-ask"]') as HTMLButtonElement | null;
    expect(ask).not.toBeNull();

    await ui.flushAsync(async () => {
      ask!.click();
      await settle();
    });
    expect(fetched).toEqual([{ path: "/api/artifacts/c2", range: `bytes=0-${PREVIEW_BYTES - 1}` }]);
    expect(ui.query('[data-slot="preview-truncated"]')).not.toBeNull();
  });

  test("never requests the bytes of a type it cannot show as text", async () => {
    await ui.flushAsync(async () => {
      ui.render(
        <ArtifactFilePage url="/api/artifacts/c3" name="site.zip" mimeType="application/zip" size={4096} />,
      );
      await settle();
    });
    expect(fetched).toEqual([]);
    expect(ui.query('[data-slot="preview-ask"]')).toBeNull();
    expect(ui.text()).toContain("No preview for this file type");
    expect(ui.query("a[download]")).not.toBeNull();
    // No embed of any kind, on any branch.
    expect(ui.query("iframe")).toBeNull();
    expect(ui.query("object")).toBeNull();
    expect(ui.query("embed")).toBeNull();
  });

  test("a text-named file that turns out binary gets the download, not a preview", async () => {
    install(() => new Uint8Array([80, 75, 3, 4, 0, 0, 1, 2]), { "content-type": "text/plain" });
    await ui.flushAsync(async () => {
      ui.render(<ArtifactFilePage url="/api/artifacts/c4" name="notes.txt" mimeType="text/plain" size={8} />);
      await settle();
    });
    expect(ui.text()).toContain("This file is not text");
    expect(ui.query('[data-slot="delimited-preview"]')).toBeNull();
  });
});
