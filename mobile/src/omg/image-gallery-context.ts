import { createContext } from 'react';
export type ImageRect = { x: number; y: number; width: number; height: number };
export type GalleryThumbnail = { uri: string; radius: number; measure: () => Promise<ImageRect | null> };
export const ImageGalleryRow = createContext<string | null>(null);
export const ImageGalleryContext = createContext<{
  register: (id: string, thumbnail: GalleryThumbnail) => () => void;
  open: (id: string, origin: ImageRect, thumbnail: GalleryThumbnail) => boolean;
} | null>(null);
