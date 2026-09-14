import type { TranscriptItem } from './transcript';
import { parseMessageAttachments } from './message-attachments';

export type GalleryImage = { id: string; rowKey: string; path: string; label: string };
export const galleryImageId = (rowKey: string, path: string) => JSON.stringify([rowKey, path]);

/** Derive order from transcript data, including rows outside the render window. */
export function transcriptImages(rows: TranscriptItem[]): GalleryImage[] {
  const images: GalleryImage[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.type !== 'message') continue;
    const message = row.message;
    const add = (path: string, label: string) => {
      const id = galleryImageId(row.key, path);
      if (seen.has(id)) return;
      seen.add(id);
      images.push({ id, rowKey: row.key, path, label });
    };
    if (message.kind === 'image') {
      const path = message.url ?? (message.artifactId ? `/api/artifacts/${message.artifactId}` : null);
      if (path) add(path, message.alt ?? message.caption ?? 'Image');
    } else if (message.role === 'user') {
      for (const attachment of parseMessageAttachments(message.text ?? '').attachments) {
        if (attachment.url) add(attachment.url, attachment.name);
      }
    }
  }
  return images;
}

export function gallerySwipe(dx: number, dy: number, vx: number): -1 | 0 | 1 {
  if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 12) return 0;
  if (Math.abs(dx) < 60 && Math.abs(vx) < 0.5) return 0;
  return dx < 0 ? 1 : -1;
}
