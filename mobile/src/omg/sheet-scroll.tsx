import { createContext, forwardRef, useCallback, useContext, useRef, type RefObject } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";

import { NativeViewGestureHandler, type PanGestureHandler } from "react-native-gesture-handler";
export const SheetNativePanContext = createContext<RefObject<PanGestureHandler | null> | null>(null);

export type SheetTouchOrigin = { offset: number; horizontal: boolean; blocked?: boolean; restore?: () => void };
export const SheetExpandedContext = createContext(false);
export const useSheetExpanded = () => useContext(SheetExpandedContext);
export const SheetDraggingContext = createContext(false);
export const SheetGestureContext = createContext<((origin: SheetTouchOrigin) => void) | null>(null);

/** Let a child interaction (such as folder reordering) keep its touch sequence. */
export function useBlockSheetDrag() {
  const claim = useContext(SheetGestureContext);
  return () => claim?.({ offset: 0, horizontal: false, blocked: true });
}

/** The innermost scroller identifies the gesture before the sheet can capture it. */
export const SheetScrollView = forwardRef<ScrollView, ScrollViewProps>(function SheetScrollView(
  { onTouchStart, onScroll, scrollEventThrottle = 16, horizontal, scrollEnabled, ...props }, ref,
) {
  const claim = useContext(SheetGestureContext);
  const pan = useContext(SheetNativePanContext);
  const dragging = useContext(SheetDraggingContext);
  const offset = useRef(0);
  const scroll = useRef<ScrollView | null>(null);
  const setRef = useCallback((node: ScrollView | null) => {
    scroll.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
  const content = <ScrollView {...props} scrollEnabled={scrollEnabled !== false && !dragging} ref={setRef} horizontal={horizontal} scrollEventThrottle={scrollEventThrottle}
    onTouchStart={event => {
      const start = offset.current;
      claim?.({ offset: start, horizontal: !!horizontal, restore: horizontal ? undefined : () => {
        offset.current = start;
        scroll.current?.scrollTo({ y: start, animated: false });
      } });
      onTouchStart?.(event);
    }}
    onScroll={event => {
      offset.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    }}
  />;
  return pan ? <NativeViewGestureHandler enabled={scrollEnabled !== false && !dragging} simultaneousHandlers={pan}>{content}</NativeViewGestureHandler> : content;
});
