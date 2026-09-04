import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  collapseArtifactRetryMessages,
  createFileArtifact,
  createImageArtifact,
  deleteArtifact,
  getImageArtifact,
  imageArtifactToMessage,
  publishHtmlArtifact,
  updateHtmlArtifactRefresh,
  type ArtifactRefreshConfig,
} from "./artifacts.ts";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

function refreshConfig(scopeRoot: string): ArtifactRefreshConfig {
  return {
    scriptPath: join(scopeRoot, "refresh.sh"),
    argv: [],
    scopeRoot,
    intervalMs: 10_000,
    timeoutMs: 2_000,
    enabled: true,
    configuredAt: 1,
    status: "idle",
  };
}

describe("artifact display retry reconciliation", () => {
  test("collapses an identical media retry while preserving transcript order", () => {
    const messages = [
      { id: "text-1", kind: "text", ts: 1, text: "before" },
      { id: "artifact-a", kind: "image", ts: 10_000, name: "shot.png", mimeType: "image/png", size: 42, caption: "Live" },
      { id: "artifact-b", kind: "image", ts: 30_000, name: "shot.png", mimeType: "image/png", size: 42, caption: "Live" },
      { id: "text-2", kind: "text", ts: 40_000, text: "after" },
    ];

    expect(collapseArtifactRetryMessages(messages).map((message) => message.id)).toEqual([
      "text-1",
      "artifact-a",
      "text-2",
    ]);
  });

  test("keeps a deliberate later display and distinct media", () => {
    const base = { kind: "image", name: "shot.png", mimeType: "image/png", size: 42, caption: "Live" };
    const messages = [
      { ...base, id: "artifact-a", ts: 10_000 },
      { ...base, id: "artifact-b", ts: 400_001 },
      { ...base, id: "artifact-c", ts: 410_000, size: 43 },
    ];

    expect(collapseArtifactRetryMessages(messages).map((message) => message.id)).toEqual([
      "artifact-a",
      "artifact-b",
      "artifact-c",
    ]);
  });
});

describe("stable HTML artifact ownership", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-artifact-ownership-"));
    PATHS.data = join(root, "data");
  });

  afterEach(() => {
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("a new session takes over an HTML id without breaking its version chain", () => {
    const originalRefresh = refreshConfig(join(root, "session-a"));
    const before = publishHtmlArtifact({
      sessionId: SESSION_A,
      id: "shared-dash",
      html: "<!doctype html><html><body>session A</body></html>",
      refresh: originalRefresh,
    });

    const after = publishHtmlArtifact({
      sessionId: SESSION_B,
      id: "shared-dash",
      html: "<!doctype html><html><body>session B</body></html>",
    });

    expect(after.sessionId).toBe(SESSION_B);
    expect(after.version).toBe(2);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.filePath).toBe(before.filePath);
    expect(after.refresh).toEqual(originalRefresh);
    expect(readFileSync(after.filePath, "utf8")).toContain("session B");

    const reboundRefresh = refreshConfig(join(root, "session-b"));
    expect(() => updateHtmlArtifactRefresh({
      id: after.id,
      sessionId: SESSION_A,
      refresh: reboundRefresh,
    })).toThrow("different session");
    expect(() => deleteArtifact({ id: after.id, sessionId: SESSION_A })).toThrow("different session");

    expect(updateHtmlArtifactRefresh({
      id: after.id,
      sessionId: SESSION_B,
      refresh: reboundRefresh,
    }).refresh).toEqual(reboundRefresh);
    expect(deleteArtifact({ id: after.id, sessionId: SESSION_B }).id).toBe(after.id);
    expect(getImageArtifact(after.id)).toBeNull();
  });

  test("an HTML publish cannot take over an image artifact id", async () => {
    const source = join(root, "image.png");
    writeFileSync(source, "not-a-real-png");
    const image = await createImageArtifact({ sessionId: SESSION_A, path: source });

    expect(() => publishHtmlArtifact({
      sessionId: SESSION_B,
      id: image.id,
      html: "<!doctype html><html><body>collision</body></html>",
    })).toThrow("different media kind");
    expect(getImageArtifact(image.id)?.media).toBe("image");
  });
});

describe("file artifacts", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-artifact-file-"));
    PATHS.data = join(root, "data");
  });

  afterEach(() => {
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  function source(name: string, body = "x"): string {
    const path = join(root, name);
    writeFileSync(path, body);
    return path;
  }

  test("types a known document format and copies the bytes into the store", () => {
    const artifact = createFileArtifact({
      sessionId: SESSION_A,
      path: source("report.pdf", "%PDF-1.4 body"),
      caption: "Q3 report",
    });

    expect(artifact.media).toBe("file");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(artifact.name).toBe("report.pdf");
    expect(artifact.caption).toBe("Q3 report");
    expect(readFileSync(artifact.filePath, "utf8")).toBe("%PDF-1.4 body");
  });

  test("types an audio clip so the transcript can play it", () => {
    const artifact = createFileArtifact({ sessionId: SESSION_A, path: source("clip.mp3") });
    expect(artifact.mimeType).toBe("audio/mpeg");
  });

  // The whole point of the kind: an unrecognized format is still displayable.
  // Image and video reject instead, which is why they cannot carry a document.
  test("accepts an unknown extension as an opaque download", () => {
    const artifact = createFileArtifact({ sessionId: SESSION_A, path: source("data.parquet") });
    expect(artifact.mimeType).toBe("application/octet-stream");
  });

  test("accepts a file with no extension at all", () => {
    const artifact = createFileArtifact({ sessionId: SESSION_A, path: source("Makefile") });
    expect(artifact.mimeType).toBe("application/octet-stream");
    expect(artifact.name).toBe("Makefile");
  });

  // Every file artifact is served as an attachment, so the stored type cannot
  // make a browser render anything. This keeps script-bearing formats off a
  // real content type anyway, so that relaxing the disposition later fails
  // safe instead of silently becoming an execution bug.
  test.each([
    ["page.html", "<script>alert(1)</script>"],
    ["page.htm", "<script>alert(1)</script>"],
    ["vector.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"],
    ["doc.xhtml", "<html xmlns='http://www.w3.org/1999/xhtml'/>"],
    ["feed.xml", "<?xml version='1.0'?><root/>"],
  ])("stores %s as an opaque type, never a renderable one", (name, body) => {
    const artifact = createFileArtifact({ sessionId: SESSION_A, path: source(name, body) });
    expect(artifact.mimeType).toBe("application/octet-stream");
  });

  test("rejects a relative path and a missing file", () => {
    expect(() => createFileArtifact({ sessionId: SESSION_A, path: "report.pdf" })).toThrow(
      /absolute/,
    );
    expect(() =>
      createFileArtifact({ sessionId: SESSION_A, path: join(root, "absent.pdf") }),
    ).toThrow();
  });

  test("renders as a file message carrying its own artifact url", () => {
    const artifact = createFileArtifact({
      sessionId: SESSION_A,
      path: source("rows.csv", "a,b\n1,2\n"),
      caption: "Export",
    });
    const message = imageArtifactToMessage(artifact);

    expect(message.kind).toBe("file");
    expect(message.mimeType).toBe("text/csv; charset=utf-8");
    expect(message.url).toBe(`/api/artifacts/${artifact.id}`);
    expect(message.name).toBe("rows.csv");
    expect(message.text).toBe("Export");
  });

  test("collapses an identical file retry the way media retries collapse", () => {
    const base = { kind: "file", name: "report.pdf", mimeType: "application/pdf", size: 9 };
    const messages = [
      { ...base, id: "artifact-a", ts: 10_000 },
      { ...base, id: "artifact-b", ts: 30_000 },
    ];
    expect(collapseArtifactRetryMessages(messages).map((m) => m.id)).toEqual(["artifact-a"]);
  });
});
