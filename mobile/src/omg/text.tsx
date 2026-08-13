/**
 * Text and TextInput with bounded Dynamic Type.
 *
 * Every screen must import Text/TextInput from HERE, not from react-native.
 *
 * Why this file exists: palette.ts documents the type scale as "pinned rather
 * than scaled", and that was true of the numbers and false of the app. Nothing
 * ever bounded Dynamic Type, so a phone with a larger accessibility text size
 * rendered the whole UI at roughly 1.5x — 17pt titles became ~25pt, cards grew
 * to twice the reference height, and the session list showed six rows where the
 * web shows eleven. It read as "the design is enormous" rather than "the OS is
 * scaling", which is exactly why it was hard to spot from a screenshot.
 *
 * The fix is a CAP, not a switch. `allowFontScaling={false}` would pin the type
 * exactly to the web and is what the web effectively does, but it also tells a
 * person who needs larger text that their setting does not apply here. A 1.15
 * ceiling keeps the layout dense enough to scan a fleet of sessions while still
 * honouring the preference — someone at 200% text still gets 15% larger, not
 * nothing.
 *
 * React 19 removed `defaultProps` for function components, so the old
 * `Text.defaultProps.allowFontScaling = false` trick is gone. A wrapper is the
 * supported way, and an explicit import is easier to audit than a global mutated
 * at startup.
 */

import { forwardRef } from "react";
import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextProps,
  type TextInputProps,
} from "react-native";

/**
 * Re-exported so callers can still type a ref (`useRef<TextInputHandle>`). The
 * wrapper is a different value from react-native's TextInput, so the class that
 * a ref actually points at has to come from somewhere.
 */
export type TextInputHandle = RNTextInput;
export type TextHandle = RNText;

/**
 * How far the OS may scale our type. Chosen against the reference: at 1.15 the
 * session list still fits the same number of cards as the web at the same
 * width, and above ~1.25 the two-line card starts clipping its subtitle.
 */
export const MAX_FONT_SCALE = 1.15;

// forwardRef, not a plain function: screens focus the code field and the
// composer through a ref, and a wrapper that swallows it silently breaks
// focus() with no type error at the call site.
/**
 * Reset tracking to 0 unless a caller asks for something else.
 *
 * iOS recycles native text views, and RN only sends props that CHANGED — so a
 * view whose new style omits `letterSpacing` keeps whatever the previous
 * occupant set. sign-in.tsx spaces its 6-digit code field by 8pt, and after
 * signing in the home composer's placeholder rendered as "W h a t   s h o u l
 * d   w e", spaced by exactly that 8. Nothing in the composer's own styles
 * mentioned tracking; it inherited it from a field on a screen that had
 * already unmounted.
 *
 * Because it goes FIRST in the style array, the type scale's own tracking
 * (largeTitle -0.4, overline 0.8, and the code field's 8) still wins wherever
 * it is set deliberately. This only fixes the case where a component said
 * nothing and got a stale value.
 */
const NO_INHERITED_TRACKING = { letterSpacing: 0 } as const;

export const Text = forwardRef<RNText, TextProps>(
  ({ maxFontSizeMultiplier, style, ...props }, ref) => (
    <RNText
      ref={ref}
      {...props}
      style={[NO_INHERITED_TRACKING, style]}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_FONT_SCALE}
    />
  ),
);
Text.displayName = "Text";

export const TextInput = forwardRef<RNTextInput, TextInputProps>(
  ({ maxFontSizeMultiplier, style, ...props }, ref) => (
    <RNTextInput
      ref={ref}
      {...props}
      style={[NO_INHERITED_TRACKING, style]}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_FONT_SCALE}
    />
  ),
);
TextInput.displayName = "TextInput";
