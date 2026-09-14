import { useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';
import { ImageGalleryContext, type GalleryThumbnail, type ImageRect } from './image-gallery-context';
import type { GalleryImage } from './image-gallery-data';
import { ImageViewer, useAuthenticatedImage } from './remote-image';

type Selection = { images: GalleryImage[]; index: number; origin: ImageRect; radius: number; uri: string | null };

/** The viewer outlives virtualized thumbnails. Only this owner holds selection. */
export function ImageGalleryProvider({ images, onReveal, children }: {
  images: GalleryImage[];
  onReveal: (rowKey: string, measure: () => Promise<ImageRect | null>) => Promise<void>;
  children: React.ReactNode;
}) {
  const screen = useWindowDimensions();
  const thumbnails = useRef(new Map<string, GalleryThumbnail>());
  const [selection, setSelection] = useState<Selection | null>(null);
  const current = selection?.images[selection.index];
  const load = useAuthenticatedImage(selection?.uri ? null : current?.path ?? null);
  const register = useCallback((id: string, thumbnail: GalleryThumbnail) => {
    thumbnails.current.set(id, thumbnail);
    return () => { if (thumbnails.current.get(id) === thumbnail) thumbnails.current.delete(id); };
  }, []);
  const open = useCallback((id: string, origin: ImageRect, thumbnail: GalleryThumbnail) => {
    const index = images.findIndex(image => image.id === id);
    if (index < 0) return false;
    Keyboard.dismiss();
    setSelection({ images: [...images], index, origin, radius: thumbnail.radius, uri: thumbnail.uri });
    return true;
  }, [images]);
  const context = useMemo(() => ({ register, open }), [register, open]);
  const reveal = async () => {
    if (!current) return null;
    const measure = async () => await thumbnails.current.get(current.id)?.measure() ?? null;
    const visible = await measure();
    if (visible && visible.y >= 100 && visible.y + visible.height <= screen.height - 100) return visible;
    await onReveal(current.rowKey, measure);
    return await measure();
  };
  return <ImageGalleryContext.Provider value={context}>
    {children}
    {selection && current ? <ImageViewer
      uri={selection.uri ?? (load.status === 'ready' ? load.uri : null)}
      imageId={current.id}
      origin={selection.origin}
      sourceRadius={selection.radius}
      accessibilityLabel={current.label}
      error={!selection.uri && load.status === 'error'}
      position={selection.index + 1}
      count={selection.images.length}
      onPage={delta => setSelection(value => {
        if (!value) return value;
        const index = value.index + delta;
        if (index < 0 || index >= value.images.length) return value;
        return { ...value, index, uri: thumbnails.current.get(value.images[index].id)?.uri ?? null };
      })}
      onBeforeClose={reveal}
      onClosed={() => setSelection(null)}
    /> : null}
  </ImageGalleryContext.Provider>;
}
