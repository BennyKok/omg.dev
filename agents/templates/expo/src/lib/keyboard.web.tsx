// Web: the browser moves the page for the keyboard itself. The native library
// touches requestAnimationFrame while the static web export renders on the
// server, so the web build uses plain views with the same props.
import type { ReactNode } from "react";
import { ScrollView, type ScrollViewProps, View, type ViewProps } from "react-native";

export function KeyboardProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function KeyboardAwareScrollView({ bottomOffset: _bottomOffset, ...props }: ScrollViewProps & { bottomOffset?: number }) {
  return <ScrollView {...props} />;
}

export function KeyboardStickyView({ offset: _offset, ...props }: ViewProps & { offset?: { closed?: number; opened?: number } }) {
  return <View {...props} />;
}
