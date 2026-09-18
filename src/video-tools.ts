/**
 * The two things the server needs from a video, both through ffmpeg.
 *
 * ffmpeg and ffprobe are system binaries, not a dependency of this package, so
 * every call here is best-effort: a box without them publishes exactly what it
 * published before (no dimensions, no poster, bytes as given). Nothing throws
 * past this file for a missing binary.
 */
import { rename, rm } from "node:fs/promises";

export type VideoProbe = { width: number; height: number; durationMs: number | null };

const PROBE_TIMEOUT_MS = 15_000;
const REMUX_TIMEOUT_MS = 60_000;
const POSTER_TIMEOUT_MS = 30_000;

async function run(
  cmd: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string }> {
  const spawned = (() => {
    try {
      return Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    } catch {
      // ENOENT: the binary is not installed.
      return null;
    }
  })();
  if (!spawned) return { ok: false, stdout: "" };
  const proc = spawned;
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return { ok: code === 0, stdout };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pixel dimensions of the first video stream, as a player shows them.
 *
 * A phone recording is often stored landscape with a 90 degree rotation tag,
 * so the displayed axes are swapped from the stored ones. The transcript
 * reserves the DISPLAYED box, which is why the rotation is applied here.
 */
export async function probeVideo(path: string): Promise<VideoProbe | null> {
  const { ok, stdout } = await run(
    [
      "ffprobe",
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:stream_side_data=rotation:format=duration",
      "-of", "json",
      path,
    ],
    PROBE_TIMEOUT_MS,
  );
  if (!ok) return null;
  try {
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{
        width?: number;
        height?: number;
        side_data_list?: Array<{ rotation?: number }>;
      }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    if (!stream?.width || !stream.height) return null;
    const rotation = Math.abs(stream.side_data_list?.[0]?.rotation ?? 0) % 180;
    const quarterTurn = rotation === 90;
    const seconds = Number(parsed.format?.duration);
    return {
      width: quarterTurn ? stream.height : stream.width,
      height: quarterTurn ? stream.width : stream.height,
      durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Move the MP4 index (`moov`) to the front of the file, in place.
 *
 * A player needs the index before it can show a frame. With `moov` at the
 * end, where most recorders write it, a streaming player has to fetch the tail
 * of the file first, and a player that cannot seek downloads the whole file
 * before the first frame. Stream copy, so no re-encode: a 20 MB file takes
 * well under a second. Only MP4-family containers have a `moov`; anything else
 * is left alone.
 */
export async function remuxFaststart(path: string): Promise<boolean> {
  if (!/\.(mp4|m4v|mov)$/i.test(path)) return false;
  const temporary = `${path}.faststart.tmp${path.slice(path.lastIndexOf("."))}`;
  const { ok } = await run(
    ["ffmpeg", "-v", "error", "-y", "-i", path, "-c", "copy", "-movflags", "+faststart", temporary],
    REMUX_TIMEOUT_MS,
  );
  if (!ok) {
    await rm(temporary, { force: true }).catch(() => undefined);
    return false;
  }
  await rename(temporary, path);
  return true;
}

/**
 * One frame, bounded to `maxEdge` on its longer side, as WebP.
 *
 * Taken from just after the start rather than at zero, because a screen
 * recording's first frame is often black or a launch splash.
 */
export async function writeVideoPoster(
  path: string,
  outputPath: string,
  maxEdge: number,
): Promise<boolean> {
  const scale = `scale='if(gt(iw,ih),min(${maxEdge},iw),-2)':'if(gt(iw,ih),-2,min(${maxEdge},ih))'`;
  const { ok } = await run(
    [
      "ffmpeg", "-v", "error", "-y",
      "-ss", "0.5",
      "-i", path,
      "-frames:v", "1",
      "-vf", scale,
      "-f", "webp", "-quality", "70",
      outputPath,
    ],
    POSTER_TIMEOUT_MS,
  );
  if (ok) return true;
  await rm(outputPath, { force: true }).catch(() => undefined);
  return false;
}
