import { useEffect, useState } from "react";

export type ThemeType = "light" | "dark";

/**
 * The app's current theme, read from the `dark` class on `<html>`, for
 * renderers that take a theme by value instead of inheriting CSS variables
 * (the Shiki-backed file viewer).
 */
export function useThemeType(): ThemeType {
  const read = (): ThemeType =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
  const [type, setType] = useState<ThemeType>(read);
  useEffect(() => {
    // Not every window has it (the test harness's does not); the first read
    // still answers for that mount.
    if (typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => setType(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return type;
}
