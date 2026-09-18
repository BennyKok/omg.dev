import { describe, expect, test, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { probeVideo, remuxFaststart, writeVideoPoster } from "./video-tools.ts";
import { getOrCreateVideoPoster, videoPosterPath } from "./artifact-previews.ts";

const cleanup = new Set<string>();
afterEach(async () => {
  await Promise.all([...cleanup].map((path) => rm(path, { recursive: true, force: true })));
  cleanup.clear();
});

const hasFfmpeg = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;

/** A one second 320x180 test card, with `moov` at the END, the way recorders write it. */
async function makeClip(dir: string, name = "clip.mp4"): Promise<string> {
  const path = join(dir, name);
  const proc = Bun.spawn(
    ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10", "-t", "1", "-pix_fmt", "yuv420p", path],
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await proc.exited) !== 0) throw new Error("ffmpeg could not write the test clip");
  return path;
}

function moovBeforeMdat(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes).toString("latin1");
  return text.indexOf("moov") < text.indexOf("mdat");
}

describe.if(hasFfmpeg)("video tools", () => {
  test("probes displayed dimensions and duration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lfg-video-"));
    cleanup.add(dir);
    const probe = await probeVideo(await makeClip(dir));
    expect(probe?.width).toBe(320);
    expect(probe?.height).toBe(180);
    expect(probe?.durationMs).toBe(1000);
  });

  test("moves moov to the front in place", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lfg-video-"));
    cleanup.add(dir);
    const path = await makeClip(dir);
    expect(moovBeforeMdat(await Bun.file(path).bytes())).toBe(false);
    expect(await remuxFaststart(path)).toBe(true);
    expect(moovBeforeMdat(await Bun.file(path).bytes())).toBe(true);
    // Still a readable video afterwards.
    expect((await probeVideo(path))?.width).toBe(320);
  });

  test("leaves a non-MP4 container alone", async () => {
    expect(await remuxFaststart("/nonexistent/clip.webm")).toBe(false);
  });

  test("writes a bounded WebP poster and the preview cache reuses it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lfg-video-"));
    cleanup.add(dir);
    const path = await makeClip(dir);
    const poster = join(dir, "poster.webp");
    expect(await writeVideoPoster(path, poster, 160)).toBe(true);
    const head = Buffer.from(await Bun.file(poster).bytes()).subarray(0, 12).toString("latin1");
    expect(head.startsWith("RIFF")).toBe(true);
    expect(head.endsWith("WEBP")).toBe(true);

    const id = `test-${randomUUID()}`;
    cleanup.add(videoPosterPath(id, "thumb"));
    const first = await getOrCreateVideoPoster({ id, filePath: path }, "thumb");
    const stat = await Bun.file(first).stat();
    const second = await getOrCreateVideoPoster({ id, filePath: path }, "thumb");
    expect(second).toBe(first);
    expect((await Bun.file(second).stat()).mtimeMs).toBe(stat.mtimeMs);
  });
});

describe("video tools without a binary", () => {
  test("probe of a missing file is null, not a throw", async () => {
    expect(await probeVideo("/nonexistent/clip.mp4")).toBeNull();
  });
  test("poster of a missing file is false and leaves no output", async () => {
    const out = join(tmpdir(), `lfg-poster-${randomUUID()}.webp`);
    expect(await writeVideoPoster("/nonexistent/clip.mp4", out, 160)).toBe(false);
    expect(await Bun.file(out).exists()).toBe(false);
  });
});
