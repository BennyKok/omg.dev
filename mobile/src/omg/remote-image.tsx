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

import { useEffect, useState } from "react";
import { Image, View, type ImageStyle, type StyleProp } from "react-native";

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
  radius,
  placeholderColor,
  fallback,
  style,
  accessibilityLabel,
}: {
  path: string;
  maxWidth: number;
  maxHeight: number;
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
  const ratio = load.status === "ready" ? (load.ratio ?? 4 / 3) : 4 / 3;
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

  return (
    <Image
      source={{ uri: load.uri }}
      accessibilityLabel={accessibilityLabel}
      accessible
      resizeMode="cover"
      style={[
        { width, height, borderRadius: radius, backgroundColor: placeholderColor },
        style,
      ]}
    />
  );
}
