// Window size that is never 0 on web.
//
// Why: in a static web export (`web.output: "static"`), `useWindowDimensions()`
// can report width 0 on the first render and stay 0 until the window resizes,
// so anything sized from it collapses. Prefer flex layout (`flex: 1`,
// `maxWidth`, `width: "100%"`) and use this hook only when a number is needed.
import { useEffect, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";

function browserSize(): { width: number; height: number } {
  if (Platform.OS !== "web" || typeof window === "undefined") return { width: 0, height: 0 };
  return { width: window.innerWidth || 0, height: window.innerHeight || 0 };
}

export function useViewport(): { width: number; height: number } {
  const dims = useWindowDimensions();
  const [web, setWeb] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const read = () => setWeb(browserSize());
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  return { width: dims.width || web.width, height: dims.height || web.height };
}

/** True from `breakpoint` px up (default 768). False until the width is known. */
export function useIsWide(breakpoint = 768): boolean {
  return useViewport().width >= breakpoint;
}
