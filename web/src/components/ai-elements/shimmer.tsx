"use client";

import { createElement } from "react";

import { cn } from "@/lib/utils";

export function Shimmer({
  children,
  as,
  className,
}: {
  children: string;
  as?: "span" | "p" | "div";
  className?: string;
}) {
  return createElement(as ?? "span", { className: cn("think-live", className) }, children);
}
