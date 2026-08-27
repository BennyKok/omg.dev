/**
 * An image whose bytes sit behind the transport's grant.
 *
 * Every URL on a Computer — an artifact, or a file the user attached — is
 * served by the session proxy, which requires `Authorization: Bearer <grant>`.
 * React Native's `<Image source={{ uri }}>` issues its own native request and
 * has no way to carry that header, which is why the transcript used to refuse
 * to draw pictures at all and named the file instead.
 *
 * So the bytes are fetched through `client.transport` (the one object that owns
 * the grant, its refresh, and the base URL of the selected machine) and handed
 * to `<Image>` as a data URI. `URL.createObjectURL`, which the web uses for the
 * same job, does not exist on React Native — a data URI is the equivalent that
 * does, and `FileReader.readAsDataURL` is the only conversion RN implements for
 * a Blob.
 *
 * WHY A `preview=1` REQUEST. The server generates a downscaled webp on demand.
 * A phone painting a 240pt tile has no business decoding a 25 MB original, and
 * the whole payload crosses a cellular link — the web surface learned this on
 * its media feed and this file starts where that ended up.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Modal,
  PanResponder,
  Pressable,
  StatusBar,
  useWindowDimensions,
  View,
  type ImageStyle,
  type StyleProp,
} from "react-native";
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useOmg } from "./provider";

type Load =
  | { status: "loading" }
  | { status: "ready"; uri: string; ratio: number | null }
  | { status: "error" };

/**
 * Blob to data URI. Wrapped in a promise because `FileReader` is callback-based
 * and this has to be awaited inside an effect that can be cancelled.
 */
function readAsDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read image bytes"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("image bytes were not a data URI"));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch an authenticated image and report what happened.
 *
 * `path` is a server path, not a URL: the transport owns the origin, and
 * hardcoding one here would target the wrong machine after a switch.
 */
export function useAuthenticatedImage(path: string | null): Load {
  const { client } = useOmg();
  const [state, setState] = useState<Load>({ status: "loading" });

  useEffect(() => {
    if (!path) return;
    // No transport, no bytes — and no way to ever get them. Report that as a
    // failure rather than leaving a grey rectangle spinning forever: the
    // caller's fallback (a named chip) is the honest thing to show, and an
    // indefinite placeholder is the "loading" state that never ends.
    if (!client) {
      setState({ status: "error" });
      return;
    }
    // Not AbortController: abort support varies by RN engine, and a stale
    // response only has to be IGNORED, not cancelled. `live` is the cheap
    // version of that and cannot leak a setState onto an unmounted component.
    let live = true;
    setState({ status: "loading" });

    void (async () => {
      try {
        const response = await client.transport.fetch(`${path}?preview=1`);
        if (!response.ok) throw new Error(`image ${response.status}`);
        const uri = await readAsDataUri(await response.blob());
        if (!live) return;
        // Ask for the intrinsic size so the tile can reserve its own shape
        // instead of jumping when the bitmap lands. A failure here is not
        // fatal: the image still draws, it just uses the fallback ratio.
        Image.getSize(
          uri,
          (width, height) => {
            if (live) {
              setState({ status: "ready", uri, ratio: height > 0 ? width / height : null });
            }
          },
          () => {
            if (live) setState({ status: "ready", uri, ratio: null });
          },
        );
      } catch {
        if (live) setState({ status: "error" });
      }
    })();

    return () => {
      live = false;
    };
  }, [path, client]);

  return state;
}

/**
 * The image itself, sized by its own aspect ratio inside a cap.
 *
 * `maxWidth`/`maxHeight` are the frame it must fit; the ratio decides which of
 * the two it actually hits. Without the ratio a wide screenshot and a tall one
 * would both be forced into the same box and one of them would be squashed —
 * the exact bug the web stylesheet documents against flexbox `stretch`.
 */
export function AuthenticatedImage({
  path,
  maxWidth,
  maxHeight,
  ratio: declaredRatio,
  radius,
  placeholderColor,
  fallback,
  style,
  accessibilityLabel,
}: {
  path: string;
  maxWidth: number;
  maxHeight: number;
  /**
   * The image's own aspect ratio, when the caller already knows it.
   *
   * An artifact message carries `width`/`height` on the wire, and using them
   * means the tile is the RIGHT SHAPE from the first frame rather than a 4:3
   * guess that reflows when the bytes land — and, with `resizeMode: contain`,
   * that a tall phone screenshot is not letterboxed inside a landscape box.
   * Measurement still wins once it arrives; this is what to believe until then.
   */
  ratio?: number | null;
  radius: number;
  placeholderColor: string;
  /** Drawn when the bytes can't be fetched — uploads live in tmpdir, which a
   *  reboot clears, so an old transcript's images are simply gone. */
  fallback: React.ReactNode;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel: string;
}) {
  const load = useAuthenticatedImage(path);

  if (load.status === "error") return <>{fallback}</>;

  // The ratio is unknown until the bytes land, so the placeholder reserves a
  // conservative landscape tile rather than collapsing to nothing and shoving
  // the transcript down when the image appears.
  const ratio =
    (load.status === "ready" ? load.ratio : null) ?? declaredRatio ?? 4 / 3;
  // Fit inside BOTH caps: start from the full width, and if that makes the
  // image taller than the cap, height becomes the binding constraint instead.
  const width = Math.min(maxWidth, maxHeight * ratio);
  const height = width / ratio;

  if (load.status === "loading") {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={{ width, height, borderRadius: radius, backgroundColor: placeholderColor }}
      />
    );
  }

  return <TappableImage uri={load.uri} {...{ width, height, radius, placeholderColor, style, accessibilityLabel }} />;
}

/**
 * The thumbnail, and the viewer it opens into.
 *
 * THE VIEWER IS MODELLED ON PHOTOS, not on a modal with a picture in it. What
 * shipped first was a cross-fade to a full-screen `Image` that closed on any
 * tap, and next to any system app it read as a web lightbox: the picture
 * appeared from nowhere with no relationship to the thing you pressed, and the
 * only way out was a tap, which is not the gesture anybody's thumb reaches for.
 *
 * Three things make the difference, and all three are here:
 *
 *  - IT GROWS FROM THE THUMBNAIL. The tile is measured in window coordinates
 *    on press, and the full-size image is transformed back onto that rect and
 *    released. So the picture you pressed becomes the picture you are looking
 *    at, and closing returns it to where it came from — the continuity iOS
 *    uses everywhere and the reason the transition is legible at all.
 *  - IT FOLLOWS YOUR FINGER OUT. Drag down and the image tracks the drag,
 *    shrinking slightly while the black behind it thins toward the transcript.
 *    Past a threshold — or on a fast flick — it goes home; short of it, it
 *    springs back. A picture that can only be dismissed by a tap feels stuck
 *    to the screen.
 *  - IT ZOOMS. Pinch to 4x, double-tap to 2.5 and back. A screenshot of a
 *    dense dashboard is the common case here and full-screen is still not
 *    enough to read one.
 *
 * PanResponder rather than a gesture library: this app already drives its
 * swipe-to-archive with it, react-native-gesture-handler is present only as
 * somebody else's transitive dependency (undeclared, and this repo has already
 * shipped one binary broken by depending on a module it did not declare), and
 * two fingers of pinch is not enough work to justify taking that risk.
 */
function TappableImage({
  uri,
  width,
  height,
  radius,
  placeholderColor,
  style,
  accessibilityLabel,
}: {
  uri: string;
  width: number;
  height: number;
  radius: number;
  placeholderColor: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel: string;
}) {
  const thumb = useRef<View>(null);
  const [origin, setOrigin] = useState<Rect | null>(null);

  /**
   * MEASURE BEFORE OPENING, and open only once the measurement lands.
   *
   * The viewer's whole transition is expressed relative to where the tile is
   * on screen, and `measureInWindow` is asynchronous — opening first and
   * measuring after would play the first frames from a rect of zeros, which is
   * a picture flying in from the top-left corner.
   */
  const open = () => {
    const node = thumb.current;
    if (!node) return;
    node.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setOrigin({ x, y, width: w, height: h });
    });
  };

  return (
    <>
      {/* `collapsable={false}`: without it this View is optimised out of the
          native hierarchy and there is nothing left to measure. */}
      <View ref={thumb} collapsable={false}>
        <Pressable
          onPress={open}
          accessibilityRole="imagebutton"
          accessibilityLabel={`${accessibilityLabel}. Open`}
          style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
        >
          <Image
            source={{ uri }}
            accessibilityLabel={accessibilityLabel}
            accessible
            resizeMode="cover"
            style={[
              { width, height, borderRadius: radius, backgroundColor: placeholderColor },
              style,
            ]}
          />
        </Pressable>
      </View>

      {origin ? (
        <ImageViewer
          uri={uri}
          origin={origin}
          sourceRadius={radius}
          accessibilityLabel={accessibilityLabel}
          onClosed={() => setOrigin(null)}
        />
      ) : null}
    </>
  );
}

type Rect = { x: number; y: number; width: number; height: number };

/** Drag past this, or flick faster than this, and the viewer goes home. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.75;
const OPEN_MS = 260;
const CLOSE_MS = 220;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 280;

function ImageViewer({
  uri,
  origin,
  sourceRadius,
  accessibilityLabel,
  onClosed,
}: {
  uri: string;
  origin: Rect;
  sourceRadius: number;
  accessibilityLabel: string;
  /** Called once the close animation has finished and the modal can go. */
  onClosed: () => void;
}) {
  const screen = useWindowDimensions();
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    Image.getSize(
      uri,
      (w, h) => setRatio(h > 0 ? w / h : null),
      () => setRatio(null),
    );
  }, [uri]);

  /**
   * The rect the image occupies when open: the whole screen, minus whatever
   * its own proportions cannot fill. Falls back to the thumbnail's shape until
   * the real one is known, so the first frame is never a wrong-shaped box.
   */
  const target = useMemo<Rect>(() => {
    const r = ratio ?? origin.width / origin.height;
    const width = Math.min(screen.width, screen.height * r);
    const height = width / r;
    return {
      x: (screen.width - width) / 2,
      y: (screen.height - height) / 2,
      width,
      height,
    };
  }, [ratio, origin, screen]);

  // 0 = sitting on the thumbnail, 1 = open. Everything else is derived.
  const progress = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const zoom = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
  }, [progress]);

  const close = useCallback(() => {
    // Home is wherever the thumbnail is, so the picture returns to the row it
    // came from rather than fading out over it.
    zoom.value = withTiming(1, { duration: CLOSE_MS });
    panX.value = withTiming(0, { duration: CLOSE_MS });
    panY.value = withTiming(0, { duration: CLOSE_MS });
    dragX.value = withTiming(0, { duration: CLOSE_MS });
    dragY.value = withTiming(0, { duration: CLOSE_MS });
    progress.value = withTiming(
      0,
      { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onClosed)();
      },
    );
  }, [progress, dragX, dragY, zoom, panX, panY, onClosed]);

  /** Pinch and drag state, kept off the render path. */
  const pinch = useRef<{ distance: number; base: number } | null>(null);
  const lastTap = useRef(0);
  const zoomedRef = useRef(false);
  const panBase = useRef({ x: 0, y: 0 });

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dy) > 4 || Math.abs(g.dx) > 4 || _e.nativeEvent.touches.length > 1,
        onPanResponderGrant: () => {
          pinch.current = null;
          panBase.current = { x: panX.value, y: panY.value };
        },
        onPanResponderMove: (e, g) => {
          const touches = e.nativeEvent.touches;
          if (touches.length > 1) {
            const [a, b] = touches;
            const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
            if (!pinch.current) {
              pinch.current = { distance, base: zoom.value };
              return;
            }
            const next = (distance / pinch.current.distance) * pinch.current.base;
            zoom.value = Math.min(MAX_ZOOM, Math.max(1, next));
            zoomedRef.current = zoom.value > 1.02;
            return;
          }
          if (zoomedRef.current) {
            // Zoomed in, a drag PANS the image rather than dismissing it —
            // otherwise you cannot look at the half you zoomed in for.
            panX.value = panBase.current.x + g.dx;
            panY.value = panBase.current.y + g.dy;
            return;
          }
          dragX.value = g.dx;
          dragY.value = g.dy;
        },
        onPanResponderRelease: (_e, g) => {
          pinch.current = null;
          if (zoomedRef.current) {
            if (zoom.value <= 1.02) {
              zoomedRef.current = false;
              zoom.value = withTiming(1, { duration: 160 });
              panX.value = withTiming(0, { duration: 160 });
              panY.value = withTiming(0, { duration: 160 });
            }
            return;
          }
          const travelled = Math.hypot(g.dx, g.dy);
          if (Math.abs(g.dy) > DISMISS_DISTANCE || Math.abs(g.vy) > DISMISS_VELOCITY) {
            close();
            return;
          }
          if (travelled < 6) {
            // A tap. Two in quick succession is the zoom toggle; one closes.
            const now = Date.now();
            if (now - lastTap.current < DOUBLE_TAP_MS) {
              lastTap.current = 0;
              const zoomingIn = !zoomedRef.current;
              zoomedRef.current = zoomingIn;
              zoom.value = withTiming(zoomingIn ? DOUBLE_TAP_ZOOM : 1, { duration: 200 });
              if (!zoomingIn) {
                panX.value = withTiming(0, { duration: 200 });
                panY.value = withTiming(0, { duration: 200 });
              }
              return;
            }
            lastTap.current = now;
            setTimeout(() => {
              if (lastTap.current && Date.now() - lastTap.current >= DOUBLE_TAP_MS) close();
            }, DOUBLE_TAP_MS);
            return;
          }
          dragX.value = withTiming(0, { duration: 200 });
          dragY.value = withTiming(0, { duration: 200 });
        },
      }),
    [close, dragX, dragY, panX, panY, zoom],
  );

  const imageStyle = useAnimatedStyle(() => {
    // At progress 0 the full-size image is transformed back onto the tile's
    // rect; at 1 it sits exactly where it belongs. One interpolation, so the
    // two ends cannot drift apart.
    const p = progress.value;
    const shrink = target.width > 0 ? origin.width / target.width : 1;
    const scale = shrink + (1 - shrink) * p;
    const fromX = origin.x + origin.width / 2 - (target.x + target.width / 2);
    const fromY = origin.y + origin.height / 2 - (target.y + target.height / 2);
    // Dragging shrinks the picture a little, the way Photos does — it reads as
    // the image being lifted off the screen rather than slid along it.
    const pull = Math.min(1, Math.abs(dragY.value) / 400);
    return {
      opacity: p,
      borderRadius: sourceRadius * (1 - p),
      transform: [
        { translateX: fromX * (1 - p) + dragX.value + panX.value },
        { translateY: fromY * (1 - p) + dragY.value + panY.value },
        { scale: scale * zoom.value * (1 - pull * 0.2) },
      ],
    };
  });

  const backdropStyle = useAnimatedStyle(() => {
    const pull = Math.min(1, Math.abs(dragY.value) / 320);
    return { opacity: progress.value * (1 - pull * 0.85) };
  });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={() => close()}
      statusBarTranslucent
    >
      <StatusBar hidden />
      <View style={{ flex: 1 }} {...responder.panHandlers}>
        <Reanimated.View
          style={[
            {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.96)",
            },
            backdropStyle,
          ]}
        />
        <Reanimated.Image
          source={{ uri }}
          accessibilityLabel={accessibilityLabel}
          accessible
          // `contain`, so a tall screenshot is readable end to end rather than
          // cropped to the middle of itself.
          resizeMode="contain"
          style={[
            {
              position: "absolute",
              left: target.x,
              top: target.y,
              width: target.width,
              height: target.height,
            },
            imageStyle,
          ]}
        />
      </View>
    </Modal>
  );
}
