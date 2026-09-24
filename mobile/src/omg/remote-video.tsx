/**
 * A video whose bytes sit behind the transport's grant.
 *
 * The same problem `remote-image.tsx` solves, with a different answer.
 *
 * Every URL on a Computer is served by the session proxy behind
 * `Authorization: Bearer <grant>`, and a native player issues its own request.
 * expo-video can carry headers on a source, but that would pin a bearer header
 * inside the player. The hosted transport instead puts the existing signed,
 * short-lived grant on the artifact URL. The proxy accepts it only on that
 * read-only route and strips it before forwarding. expo-video can then request
 * byte ranges itself and begin playback before the complete file is on disk.
 * Older/custom transports fall back to the native file download.
 *
 * And nothing is downloaded until the user asks. What shows first is the
 * server's poster frame (`?preview=1` on a video artifact, a few KB), in the
 * box the player will occupy, with a play glyph over it. A transcript that
 * pulled every recording in it as it scrolled past was the wrong default on
 * a cellular link, and the web surface (AuthenticatedArtifactVideo) gates on
 * the tap the same way.
 *
 * ── The modules are required lazily, and that is load-bearing ─────────────
 *
 * expo-video and expo-file-system are NATIVE. They cannot ship over the air,
 * so every build made before they were added -- including one somebody is
 * running right now -- does not have them. A static import would crash that
 * app at module load, taking the whole transcript with it. Required lazily,
 * a missing module degrades to the same honest card the app showed before
 * video had a renderer at all.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { Icon } from "../components";
import { useOmg } from "./provider";
import { AuthenticatedImage } from "./remote-image";
import { Text } from "./text";
import { useTheme } from "./theme";
import { signedRequestFor } from "./transport";
import { videoCacheName } from "./video-cache";

type VideoModules = {
  video: typeof import("expo-video");
  fs: typeof import("expo-file-system");
};

/** Null on any build that predates the native modules. Resolved once. */
let modules: VideoModules | null | undefined;
function videoModules(): VideoModules | null {
  if (modules !== undefined) return modules;
  try {
    /*
     * ASK FIRST, and do not rely on the require throwing.
     *
     * expo-video's JS calls requireNativeModule at import, so on a build
     * without it the require below does throw -- but that is a detail of
     * someone else's module, and the failure mode if it ever stops throwing
     * is a crash inside the transcript rather than a card. This is the same
     * check attachments.ts makes for ExpoIap: ask the core whether the native
     * module is there, and only then load the JS that assumes it.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("expo-modules-core") as {
      requireOptionalNativeModule?: (name: string) => unknown;
    };
    if (core.requireOptionalNativeModule?.("ExpoVideo") == null) {
      modules = null;
      return modules;
    }
    modules = {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      video: require("expo-video") as typeof import("expo-video"),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      fs: require("expo-file-system") as typeof import("expo-file-system"),
    };
  } catch {
    modules = null;
  }
  return modules;
}

/** True when this build can play video at all. Callers use it to pick a renderer. */
export function canPlayVideo(): boolean {
  return videoModules() !== null;
}

/**
 * Pull the bytes once and keep them.
 *
 * The cache name is a pure function of the path (see video-cache.ts), so the
 * same artifact scrolled past twice reuses the file instead of pulling a video
 * down a cellular link again.
 */
async function download(
  fetchPath: (path: string) => Promise<Response>,
  bindingId: string | null,
  path: string,
  fs: VideoModules["fs"],
): Promise<string> {
  const file = new fs.File(fs.Paths.cache, videoCacheName(path));
  if (file.exists) return file.uri;
  // Written to a temporary name and then moved, so a download interrupted
  // half way cannot leave a truncated file that `exists` reports as a cache
  // hit forever after.
  const part = new fs.File(fs.Paths.cache, `${videoCacheName(path)}.part`);
  if (part.exists) part.delete();

  const signed = bindingId ? await signedRequestFor(bindingId, path) : null;
  if (signed) {
    const attempt = async (forceRefresh: boolean) => {
      const request = forceRefresh ? await signedRequestFor(bindingId!, path, { forceRefresh }) : signed;
      if (!request) throw new Error("unsigned");
      await fs.File.downloadFileAsync(request.url, part, {
        headers: request.headers,
        idempotent: true,
      });
    };
    try {
      await attempt(false);
    } catch (error) {
      // The grant died between mint and use. Same one-retry rule the
      // transport's own fetch applies.
      if (!/401/.test(String(error))) throw error;
      await attempt(true);
    }
  } else {
    const response = await fetchPath(path);
    if (!response.ok) throw new Error(`${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    part.create();
    part.write(bytes);
  }
  part.move(file);
  return file.uri;
}

/** Fit a ratio inside both caps; the ratio decides which one binds. */
function fitBox(ratio: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const width = Math.min(maxWidth, maxHeight * ratio);
  return { width, height: width / ratio };
}

export function RemoteVideo({
  path,
  label,
  ratio: declaredRatio,
  maxWidth,
  maxHeight,
}: {
  /** A server path, not a URL: the transport owns the origin. */
  path: string;
  label?: string | null;
  /**
   * width / height from the artifact, when the server recorded it. This is
   * what makes a portrait recording get a portrait box before any bytes
   * arrive, instead of a 200pt letterbox with the picture in the middle.
   */
  ratio?: number | null;
  maxWidth: number;
  maxHeight: number;
}) {
  const { client, bindingId } = useOmg();
  const { colors, radius, type, space } = useTheme();
  const loaded = videoModules();
  const [requested, setRequested] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!requested || !loaded || !client) return;
    // `client` null is handled below, not here: there is no transport, so
    // there are no bytes and no way to ever get them. Spinning forever would
    // be the wrong answer to a question that is already settled.
    setUri(null);
    setFailed(false);
    void (async () => {
      const signed = bindingId ? await signedRequestFor(bindingId, path) : null;
      const direct =
        signed?.url ??
        client.transport.assetUrl?.(path) ??
        null;
      return direct ?? download((p) => client.transport.fetch(p), bindingId, path, loaded.fs);
    })()
      .then((local) => {
        if (!cancelled.current) setUri(local);
      })
      .catch(() => {
        // Uploads live in the Computer's tmpdir, which a restart clears, so a
        // missing file is ordinary rather than exceptional. Say so once.
        if (!cancelled.current) setFailed(true);
      });
    return () => {
      cancelled.current = true;
    };
  }, [requested, client, bindingId, loaded, path]);

  if (!loaded) return <UnplayableVideo label={label} reason="update" />;
  /*
   * No transport, no bytes -- and no way to ever get them. remote-image.tsx
   * reports the same state rather than drawing a placeholder that never
   * resolves; this used to spin indefinitely.
   */
  if (!client || failed) return <UnplayableVideo label={label} reason="gone" />;

  // A landscape guess only when the artifact is silent about its shape.
  const box = fitBox(declaredRatio ?? 16 / 9, maxWidth, maxHeight);

  if (uri) {
    // A signed URL carries a grant that lives ten minutes, and the player
    // keeps requesting ranges from that URL as it plays and seeks. Once the
    // grant expires those requests get 401 and playback stops, so the player
    // is handed a way to sign the same path again. A cached local file or a
    // same-origin URL has no grant and gets no renewal.
    const renew =
      bindingId && uri.includes("__omg_grant=")
        ? () => signedRequestFor(bindingId, path, { forceRefresh: true }).then((r) => r?.url ?? null)
        : undefined;
    return <Player video={loaded.video} uri={uri} box={box} renew={renew} />;
  }

  const still = (
    // pointerEvents none is load-bearing. AuthenticatedImage draws a tappable
    // image that opens the photo viewer on press, so without this the tap on
    // a poster zoomed into a still frame ("1 / 1") and never reached the
    // Pressable below. Seen on the iPhone 17 simulator on the first OTA.
    <View pointerEvents="none">
      <AuthenticatedImage
        path={path}
        accessibilityLabel={label || "Video"}
        maxWidth={maxWidth}
        maxHeight={maxHeight}
        ratio={declaredRatio}
        radius={radius.md}
        placeholderColor={colors.codeBg}
        // No poster (a box without ffmpeg, or a clip published before posters
        // existed): the same box, plain black, still with the play glyph.
        fallback={<View style={{ ...box, borderRadius: radius.md, backgroundColor: "#000" }} />}
        style={{ resizeMode: "contain" }}
      />
    </View>
  );

  return (
    <Pressable
      onPress={() => setRequested(true)}
      disabled={requested}
      accessibilityRole="button"
      accessibilityLabel={label ? `Play ${label}` : "Play video"}
      style={{ alignSelf: "flex-start", opacity: requested ? 0.7 : 1 }}
    >
      {still}
      <View
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
        >
          {requested ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Icon ios="play.fill" android="play_arrow" size={24} color="#fff" />
          )}
        </View>
      </View>
    </Pressable>
  );
}

/** Consecutive re-signs before a failure is reported as final. */
const MAX_RENEWALS = 2;

/**
 * Split out so `useVideoPlayer` is only ever called with a real file.
 *
 * The hook cannot be called conditionally, and it cannot be called at all on a
 * build without the module, so the component that calls it is only mounted
 * once both of those are settled.
 */
function Player({
  video,
  uri,
  box,
  renew,
}: {
  video: VideoModules["video"];
  uri: string;
  box: { width: number; height: number };
  /** Sign the same path again. Absent when the URL carries no grant. */
  renew?: () => Promise<string | null>;
}) {
  const { radius } = useTheme();
  const player = video.useVideoPlayer(uri, (instance) => {
    // Requested by an explicit tap, so it starts rather than asking for a
    // second press. No loop: it sits in a transcript somebody is reading.
    instance.loop = false;
    instance.muted = false;
    instance.play();
  });
  // Renew on error, resume where it stopped. At most MAX_RENEWALS in a row:
  // a file that is really gone must still end in an error, not a loop.
  // Playing again resets the count, so a long video survives every expiry.
  const failures = useRef(0);
  useEffect(() => {
    if (!renew) return;
    const status = player.addListener("statusChange", ({ status: next }) => {
      if (next !== "error" || failures.current >= MAX_RENEWALS) return;
      failures.current += 1;
      const at = player.currentTime;
      void renew()
        .then(async (fresh) => {
          if (!fresh) return;
          await player.replaceAsync(fresh);
          player.currentTime = at;
          player.play();
        })
        .catch(() => {});
    });
    const playing = player.addListener("playingChange", ({ isPlaying }) => {
      if (isPlaying) failures.current = 0;
    });
    return () => {
      status.remove();
      playing.remove();
    };
  }, [player, renew]);
  return (
    <video.VideoView
      player={player}
      style={{ ...box, borderRadius: radius.md, backgroundColor: "#000" }}
      contentFit="contain"
      nativeControls
      // Fullscreen is the point for a screen recording of a bug: the inline
      // frame is a preview, the fullscreen one is where it can be read.
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture
    />
  );
}

/**
 * The honest card. Two different reasons, said differently, because the
 * answers are different: one needs a newer app, the other is simply gone.
 */
function UnplayableVideo({ label, reason }: { label?: string | null; reason: "update" | "gone" }) {
  const { colors, type, space, radius } = useTheme();
  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        maxWidth: "90%",
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        backgroundColor: colors.card,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong,
      }}
    >
      <Icon ios="film" android="movie" size={14} color={colors.textMuted} />
      <Text numberOfLines={2} style={{ ...type.caption, color: colors.textMuted, flexShrink: 1 }}>
        {reason === "update"
          ? `${label || "Video"} · update omg from the App Store to play it here`
          : `${label || "Video"} · no longer on the computer`}
      </Text>
    </View>
  );
}
