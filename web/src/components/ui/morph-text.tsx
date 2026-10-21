import { useEffect, useRef, type CSSProperties, type ElementType } from "react";
import { cn } from "@/lib/utils";
import { observeVisibleAnimation } from "@/lib/visible-animation";

export type MorphTextProps = {
  children: string;
  shimmer?: boolean;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
};

// Keep the label as one text node. Glyph morphing forced layout on mount and
// every update; an opacity transition needs no geometry and never delays text.
export function MorphText({ children, shimmer, as: Tag = "span", className, style, disabled }: MorphTextProps) {
  const ref = useRef<HTMLElement>(null);
  const active = useRef(false);
  const animation = useRef<Animation | undefined>(undefined);
  const previous = useRef(children);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const dispose = observeVisibleAnimation(element, (visible) => {
      active.current = visible;
      element.style.setProperty("--shimmer-play-state", visible ? "running" : "paused");
      if (!visible) animation.current?.cancel();
    });
    return () => {
      dispose();
      animation.current?.cancel();
    };
  }, [Tag]);

  useEffect(() => {
    const changed = previous.current !== children;
    previous.current = children;
    animation.current?.cancel();
    if (!changed || disabled || !active.current) return;
    animation.current = ref.current?.animate?.(
      [{ opacity: 0.65 }, { opacity: 1 }],
      { duration: 120, easing: "ease-out" },
    );
  }, [children, disabled, Tag]);

  return (
    <Tag
      ref={ref}
      data-slot={shimmer ? "shimmer-text" : undefined}
      data-text={shimmer ? children : undefined}
      className={cn(shimmer && "lfg-shimmer-text", className)}
      style={style}
    >
      {children}
    </Tag>
  );
}
