import type { ImageRect } from './image-gallery-context';
type Ref<T> = { current: T };
export type GalleryScrollTarget = { index: number; failed: boolean };
export type GalleryList = {
  scrollToIndex: (options: { index: number; animated: boolean; viewPosition: number }) => void;
  scrollToOffset: (options: { offset: number; animated: boolean }) => void;
};

/** Bring an unmeasured, virtualized image into view before closing its viewer. */
export async function revealGalleryThumbnail({ list, offset, pending, findIndex, measure }: {
  list: Ref<GalleryList | null>;
  offset: Ref<number>;
  pending: Ref<GalleryScrollTarget | null>;
  findIndex: () => number;
  measure: () => Promise<ImageRect | null>;
}) {
  const restore = { index: 0, failed: false };
  pending.current = restore;
  try {
    for (const delay of [120, 240, 480, 800, 1000]) {
      const index = findIndex();
      if (index < 0 || !list.current) return;
      restore.index = index;
      restore.failed = false;
      list.current.scrollToIndex({ index, animated: false, viewPosition: 0.3 });
      await new Promise(resolve => setTimeout(resolve, delay));
      if (pending.current !== restore) return;
      const rect = await measure();
      if (!restore.failed && rect) {
        list.current?.scrollToOffset({ offset: Math.max(0, offset.current + rect.y - 140), animated: false });
        await new Promise(resolve => setTimeout(resolve, 120));
        return;
      }
    }
  } finally {
    if (pending.current === restore) pending.current = null;
  }
}

export function retryGalleryScroll(list: GalleryList | null, target: GalleryScrollTarget | null, averageItemLength: number) {
  if (!target) return;
  target.failed = true;
  list?.scrollToOffset({ offset: Math.max(0, averageItemLength * target.index), animated: false });
}
