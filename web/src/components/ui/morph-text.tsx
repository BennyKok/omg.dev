import { TextMorph, type TextMorphProps } from "torph/react";
import { cn } from "@/lib/utils";

/**
 * Text that morphs letter by letter when its content changes (torph).
 *
 * Wraps `torph/react` so callers never need to know about the fallback. Torph
 * animates with the Web Animations API and calls `getAnimations()` on
 * teardown even when `disabled`, so under happy-dom (tests) or a browser
 * without WAAPI it would throw. In that case this renders a plain element with
 * the same tag, class and text, so the content is identical and only the
 * motion is gone. Reduced-motion is honoured by torph itself.
 *
 * `shimmer` wraps the morph in the ShimmerText treatment (.lfg-shimmer-text).
 * That effect paints its highlight on a ::before copy of the string, which is
 * the only approach that survives torph: the glyphs it moves carry their own
 * transforms, so a `background-clip: text` on the container cannot paint
 * through them and the label went fully transparent. The overlay copy sits at
 * the settled positions, so at worst a glyph in the highlight band shows its
 * final spot a few frames early during the morph.
 */
const supportsMorph =
  typeof Element !== "undefined" &&
  typeof Element.prototype.animate === "function" &&
  typeof Element.prototype.getAnimations === "function";

export type MorphTextProps = Omit<TextMorphProps, "children"> & {
  children: string;
  shimmer?: boolean;
};

export function MorphText({ children, shimmer, as: Tag = "span", className, style, ...props }: MorphTextProps) {
  const innerClass = shimmer ? undefined : className;
  const innerStyle = shimmer ? undefined : style;
  let inner: React.ReactNode;
  if (supportsMorph) {
    inner = (
      <TextMorph as={Tag} className={innerClass} style={innerStyle} {...props}>
        {children}
      </TextMorph>
    );
  } else {
    const Fallback = Tag as "span";
    inner = (
      <Fallback className={innerClass} style={innerStyle}>
        {children}
      </Fallback>
    );
  }
  if (!shimmer) return inner;
  return (
    <span data-slot="shimmer-text" data-text={children} className={cn("lfg-shimmer-text", className)} style={style}>
      {inner}
    </span>
  );
}
