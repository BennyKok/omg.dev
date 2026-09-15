/**
 * A video whose bytes sit behind the transport's grant.
 *
 * The same problem `remote-image.tsx` solves, with a different answer.
 *
 * Every URL on a Computer is served by the session proxy behind
 * `Authorization: Bearer <grant>`, and a native player issues its own request.
 * expo-video CAN carry headers on a source, and that was the obvious route,
 * but the grant is deliberately short-lived and the transport deliberately
 * exposes no URL for exactly this reason -- `assetUrl` returns null and says
 * so. Handing a player a token to replay for the length of a video means
 * re-implementing refresh, and a token that expires mid-playback stalls the
 * picture with nothing to show for it.
 *
 * So the bytes come down through `client.transport.fetch`, which already owns
 * the grant, its refresh and the 401 retry, and are written to a file. The
 * player is then pointed at a local path and carries no auth at all. This is
 * also what the web does -- see AuthenticatedArtifactVideo, which pulls the
 * whole blob before the `<video>` exists -- so both surfaces behave the same.
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
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Icon } from "../components";
import { useOmg } from "./provider";
import { Text } from "./text";
import { useTheme } from "./theme";
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
  path: string,
  fs: VideoModules["fs"],
): Promise<string> {
  const file = new fs.File(fs.Paths.cache, videoCacheName(path));
  if (file.exists) return file.uri;
  const response = await fetchPath(path);
  if (!response.ok) throw new Error(`${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Written to a temporary name and then moved, so a download interrupted
  // half way cannot leave a truncated file that `exists` reports as a cache
  // hit forever after.
  const part = new fs.File(fs.Paths.cache, `${videoCacheName(path)}.part`);
  if (part.exists) part.delete();
  part.create();
  part.write(bytes);
  part.move(file);
  return file.uri;
}

export function RemoteVideo({
  path,
  label,
  style,
}: {
  /** A server path, not a URL: the transport owns the origin. */
  path: string;
  label?: string | null;
  style?: { height?: number };
}) {
  const { client } = useOmg();
  const { colors, radius, type, space } = useTheme();
  const loaded = videoModules();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!loaded || !client) return;
    setUri(null);
    setFailed(false);
    void download((p) => client.transport.fetch(p), path, loaded.fs)
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
  }, [client, loaded, path]);

  if (!loaded) return <UnplayableVideo label={label} reason="update" />;
  if (failed) return <UnplayableVideo label={label} reason="gone" />;

  const height = style?.height ?? 200;
  if (!uri) {
    return (
      <View
        style={{
          width: "100%",
          height,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          gap: space.sm,
        }}
      >
        <ActivityIndicator color={colors.textMuted} />
        <Text style={{ ...type.caption, color: colors.textMuted }}>Loading video…</Text>
      </View>
    );
  }
  return <Player video={loaded.video} uri={uri} height={height} />;
}

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
  height,
}: {
  video: VideoModules["video"];
  uri: string;
  height: number;
}) {
  const { radius } = useTheme();
  const player = video.useVideoPlayer(uri, (instance) => {
    // No autoplay and no loop: this sits in a transcript somebody is reading,
    // and a picture that starts moving while they read the line above it is
    // the thing every chat app learned not to do.
    instance.loop = false;
    instance.muted = false;
  });
  return (
    <video.VideoView
      player={player}
      style={{ width: "100%", height, borderRadius: radius.md, backgroundColor: "#000" }}
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
