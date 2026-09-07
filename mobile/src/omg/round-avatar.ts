/**
 * A roster avatar as a ROUND bitmap on disk, for the system menu.
 *
 * UIMenu takes a UIImage and nothing else: the SwiftUI `Image` we hand it
 * through @expo/ui is flattened to its bitmap, and `clipShape("circle")` on
 * it is dropped on the floor (confirmed on the iPad simulator, 2026-09-07:
 * the row mark stayed square while the RN `Image` trigger with a
 * `borderRadius` beside it was round). So the circle has to be IN the pixels.
 *
 * Nothing native is available for that without a dev-client rebuild
 * (no image manipulator, no Skia, no view-shot), and the picture is 20pt, so
 * this decodes it in JS, resamples to 60px, cuts the disc with an
 * anti-aliased alpha edge, and writes a PNG to the cache directory. That file
 * URI is what the menu's `Image` reads.
 */
import { File, Paths } from "expo-file-system";
import { decode as decodeJpeg } from "jpeg-js";
import * as UPNG from "upng-js";

/** 20pt at @3x. */
const SIZE = 60;

const pending = new Map<string, Promise<string | null>>();

/** Resolves to a `file://` URI of the round PNG, or null when the picture
 * cannot be fetched or decoded. Cached per URL for the life of the app. */
export function roundAvatarFileUri(url: string): Promise<string | null> {
  let task = pending.get(url);
  if (!task) {
    task = render(url).catch(() => null);
    pending.set(url, task);
  }
  return task;
}

async function render(url: string): Promise<string | null> {
  const file = new File(Paths.cache, `round-avatar-${hash(url)}.png`);
  if (file.exists) return file.uri;

  const response = await fetch(url);
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const source = decodeImage(bytes);
  if (!source) return null;

  const out = resampleToSquare(source, SIZE);
  maskDisc(out, SIZE);
  const png = UPNG.encode([out.buffer as ArrayBuffer], SIZE, SIZE, 0);
  file.write(new Uint8Array(png));
  return file.uri;
}

type Rgba = { width: number; height: number; data: Uint8Array };

function decodeImage(bytes: Uint8Array): Rgba | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const jpeg = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true });
    return { width: jpeg.width, height: jpeg.height, data: jpeg.data };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const image = UPNG.decode(buffer);
    const frame = UPNG.toRGBA8(image)[0];
    if (!frame) return null;
    return { width: image.width, height: image.height, data: new Uint8Array(frame) };
  }
  return null;
}

/** Centre-crop to a square and box-average down (or nearest up) to `size`. */
function resampleToSquare(src: Rgba, size: number): Uint8Array {
  const side = Math.min(src.width, src.height);
  const ox = (src.width - side) >> 1;
  const oy = (src.height - side) >> 1;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy0 = oy + Math.floor((y * side) / size);
    const sy1 = Math.max(sy0 + 1, oy + Math.floor(((y + 1) * side) / size));
    for (let x = 0; x < size; x++) {
      const sx0 = ox + Math.floor((x * side) / size);
      const sx1 = Math.max(sx0 + 1, ox + Math.floor(((x + 1) * side) / size));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.data[i] ?? 0;
          g += src.data[i + 1] ?? 0;
          b += src.data[i + 2] ?? 0;
          n++;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Alpha outside the inscribed circle goes to 0, with a 1px soft edge. */
function maskDisc(rgba: Uint8Array, size: number): void {
  const c = size / 2;
  const radius = c;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.sqrt(dx * dx + dy * dy);
      const coverage = Math.min(1, Math.max(0, radius - d + 0.5));
      rgba[(y * size + x) * 4 + 3] = Math.round(coverage * 255);
    }
  }
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
