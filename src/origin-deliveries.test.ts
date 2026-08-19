import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import sharp from "sharp";
import { createImageArtifact } from "./artifacts.ts";
import {
  createOriginDelivery,
  indexOriginDeliveryMedia,
  listOriginDeliveries,
} from "./origin-deliveries.ts";
import {
  indexedMessagePage,
  resetTranscriptIndexConnectionForTests,
  sessionIndexKey,
} from "./transcript-index.ts";

const SESSION = "11111111-1111-4111-8111-111111111111";

describe("origin deliveries", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-origin-delivery-"));
    PATHS.data = join(root, "data");
    resetTranscriptIndexConnectionForTests();
  });

  afterEach(() => {
    resetTranscriptIndexConnectionForTests();
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("persists a session-scoped channel-neutral delivery", () => {
    const delivery = createOriginDelivery({
      sessionId: SESSION,
      text: "here is the result",
      media: [{ path: "/api/artifacts/shot-1", kind: "image", mimeType: "image/png" }],
      now: 100,
    });
    expect(delivery.target).toBe("origin");
    expect(listOriginDeliveries(SESSION)).toEqual([delivery]);
    expect(listOriginDeliveries("22222222-2222-4222-8222-222222222222")).toEqual([]);
  });

  test("dedupes a transport retry without suppressing a later intentional send", () => {
    const input = { sessionId: SESSION, text: "same update" };
    const first = createOriginDelivery({ ...input, now: 100 });
    const retry = createOriginDelivery({ ...input, now: 101 });
    const later = createOriginDelivery({ ...input, now: 31_001 });
    expect(retry.id).toBe(first.id);
    expect(later.id).not.toBe(first.id);
  });

  test("indexes origin media into the owning bot transcript without duplicates", async () => {
    const source = join(root, "origin-shot.png");
    await sharp({
      create: { width: 96, height: 64, channels: 3, background: "#7c3aed" },
    }).png().toFile(source);
    const artifact = await createImageArtifact({
      sessionId: SESSION,
      path: source,
      caption: "Delivered to the origin",
    });
    const indexPath = sessionIndexKey(SESSION);

    expect(indexOriginDeliveryMedia({ indexPath, sessionId: SESSION, artifacts: [artifact] })).toBe(1);
    expect(indexOriginDeliveryMedia({ indexPath, sessionId: SESSION, artifacts: [artifact] })).toBe(0);

    const page = await indexedMessagePage(indexPath, SESSION, { limit: 20 });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({
      id: `artifact-${artifact.id}`,
      kind: "image",
      caption: "Delivered to the origin",
      url: `/api/artifacts/${artifact.id}`,
    });
  });
});
