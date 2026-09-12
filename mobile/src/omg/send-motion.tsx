import { createContext, useContext, useMemo } from "react";
import { useAnimatedStyle, useSharedValue, type EntryAnimationsValues, type SharedValue } from "react-native-reanimated";
import { sendOriginTransform, type SendOrigin } from "./send-motion-layout";

export const SEND_DURATION = 400;
export const SEND_DELAY = 64;
export const SendOriginContext = createContext<{ origin: SendOrigin; progress: SharedValue<number>; ready: SharedValue<boolean> } | null>(null);

/** The bubble and list share a UI-thread clock; its text keeps its normal size. */
export function useSendEntrance() {
  const transition = useContext(SendOriginContext);
  const origin = transition?.origin;
  const progress = transition?.progress;
  const ready = transition?.ready;
  const start = useSharedValue({ translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 });
  const bubbleStyle = useAnimatedStyle(() => {
    const p = progress ? progress.value : 1;
    const from = start.value;
    return { transform: [
      { translateX: from.translateX * (1 - p) }, { translateY: from.translateY * (1 - p) },
      { scaleX: from.scaleX + (1 - from.scaleX) * p },
      { scaleY: from.scaleY + (1 - from.scaleY) * p },
    ] };
  });
  const contentStyle = useAnimatedStyle(() => {
    const p = progress ? progress.value : 1;
    const from = start.value;
    return { transform: [
      { scaleX: 1 / (from.scaleX + (1 - from.scaleX) * p) },
      { scaleY: 1 / (from.scaleY + (1 - from.scaleY) * p) },
    ] };
  });
  // Reanimated supplies the final native bubble rectangle before it paints.
  const entering = useMemo(() => origin ? (values: EntryAnimationsValues) => {
    "worklet";
    start.value = sendOriginTransform(origin, {
      x: values.targetGlobalOriginX, y: values.targetGlobalOriginY,
      width: values.targetWidth, height: values.targetHeight,
    });
    if (ready) ready.value = true;
    return { initialValues: {}, animations: {} };
  } : undefined, [origin, start, ready]);
  return { entering, bubbleStyle, contentStyle };
}
