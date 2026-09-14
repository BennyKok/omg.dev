import { expect, test } from 'bun:test';
import { galleryImageId, gallerySwipe, transcriptImages } from '../mobile/src/omg/image-gallery-data';
import { revealGalleryThumbnail, retryGalleryScroll, type GalleryScrollTarget } from '../mobile/src/omg/image-gallery-scroll';

test('gallery follows message order and keeps repeated paths tied to their own row', () => {
  const result = transcriptImages([
    { type: 'stamp', key: 'stamp', ts: 1 },
    { type: 'message', key: 'first', message: { role: 'assistant', kind: 'image', url: '/api/artifacts/a', alt: 'First' } },
    { type: 'message', key: 'upload', message: { role: 'user', text: 'Look\n\nAttached files:\n- photo.png: /tmp/lfg-uploads/photo.png\n- notes.txt: /tmp/lfg-uploads/notes.txt' } },
    { type: 'message', key: 'last', message: { role: 'assistant', kind: 'image', artifactId: 'a' } },
  ]);
  expect(result.map(image => image.rowKey)).toEqual(['first', 'upload', 'last']);
  expect(result[0].id).toBe(galleryImageId('first', '/api/artifacts/a'));
  expect(result[0].id).not.toBe(result[2].id);
  expect(result[1].label).toBe('photo.png');
});

test('horizontal paging rejects taps, short drags and vertical dismissals', () => {
  expect(gallerySwipe(-100, 10, -0.1)).toBe(1);
  expect(gallerySwipe(100, 10, 0.1)).toBe(-1);
  expect(gallerySwipe(-20, 2, -0.8)).toBe(1);
  expect(gallerySwipe(-20, 2, -0.1)).toBe(0);
  expect(gallerySwipe(2, 0, 1)).toBe(0);
  expect(gallerySwipe(-50, 140, -1)).toBe(0);
});

test('return scroll retries unmeasured rows then aligns the selected thumbnail', async () => {
  const pending = { current: null as GalleryScrollTarget | null };
  const offset = { current: 0 };
  const indices: number[] = [];
  const offsets: number[] = [];
  const list = { current: {
    scrollToIndex: ({ index }: { index: number }) => {
      indices.push(index);
      if (indices.length === 1) retryGalleryScroll(list.current, pending.current, 100);
    },
    scrollToOffset: ({ offset: value }: { offset: number }) => { offsets.push(value); offset.current = value; },
  } };
  await revealGalleryThumbnail({ list, offset, pending, findIndex: () => 20,
    measure: async () => indices.length > 1 ? { x: 10, y: 300, width: 200, height: 160 } : null });
  expect(indices).toEqual([20, 20]);
  expect(offsets).toEqual([2000, 2160]);
  expect(pending.current).toBeNull();
});

test('a removed gallery row does not leave a pending scroll', async () => {
  const pending = { current: null as GalleryScrollTarget | null };
  await revealGalleryThumbnail({ list: { current: null }, offset: { current: 0 }, pending,
    findIndex: () => -1, measure: async () => null });
  expect(pending.current).toBeNull();
});
