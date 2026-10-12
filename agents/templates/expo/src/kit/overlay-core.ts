// Pure stack logic for the overlay host. Only the top item is ever visible.
export type OverlayItem<T> = { id: number; content: T };

export function pushOverlay<T>(stack: OverlayItem<T>[], item: OverlayItem<T>, replace: boolean): OverlayItem<T>[] {
  // `replace` swaps the top item (a sheet opening over a sheet).
  return replace && stack.length > 0 ? [...stack.slice(0, -1), item] : [...stack, item];
}

export function removeOverlay<T>(stack: OverlayItem<T>[], id: number): OverlayItem<T>[] {
  return stack.filter((item) => item.id !== id);
}
