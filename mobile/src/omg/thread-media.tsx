import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import type { ThreadMedia } from "../../../packages/protocol/src/threads";
import { AuthenticatedImage } from "./remote-image";
import { RemoteVideo } from "./remote-video";
import { AttachmentEntry } from "./transcript";
import { Text } from "./text";
import { useTheme } from "./theme";

/** The session chat's cap, so a landscape picture does not own an iPad pane. */
const MAX_WIDTH = 560;

function ratioOf(media: ThreadMedia): number | null {
  return media.width && media.height ? media.width / media.height : null;
}

function FileRow({ media }: { media: ThreadMedia }) {
  const router = useRouter();
  const name = media.name || "File";
  return (
    <AttachmentEntry
      message={{ id: media.path, role: "assistant", kind: "file", text: "", ts: 0, url: media.path, name }}
      onPress={() => router.push({ pathname: "/artifact/file", params: { url: media.path, name, mime: "", size: "", caption: media.caption ?? "" } })}
    />
  );
}

/**
 * A message's pictures, videos and files, drawn the way the session chat
 * draws an agent's: the same authenticated image (tap to open, pinch to
 * zoom), the same video player, the same file row. Sized to the message
 * column, which is narrower than a transcript's by the avatar.
 */
export function ThreadMediaList({ media }: { media?: ThreadMedia[] }) {
  const { colors, type, radius, space } = useTheme();
  const [width, setWidth] = useState(0);
  if (!media?.length) return null;
  const maxWidth = Math.min(MAX_WIDTH, width);
  return (
    <View testID="thread-media" onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ gap: space.sm, paddingTop: 4 }}>
      {width > 0
        ? media.map((row) => (
            <View key={row.path} style={{ gap: 4 }}>
              {row.kind === "image" ? (
                <AuthenticatedImage
                  path={row.path}
                  accessibilityLabel={row.caption || row.name || "Image"}
                  maxWidth={maxWidth}
                  maxHeight={360}
                  ratio={ratioOf(row)}
                  radius={radius.xl}
                  placeholderColor={colors.codeBg}
                  fallback={<FileRow media={row} />}
                  style={{ resizeMode: "contain" }}
                />
              ) : row.kind === "video" ? (
                <RemoteVideo path={row.path} label={row.name ?? row.caption ?? null} maxWidth={maxWidth} maxHeight={360} ratio={ratioOf(row)} />
              ) : (
                <FileRow media={row} />
              )}
              {row.caption && row.kind !== "file" ? (
                <Text style={{ ...type.caption, color: colors.textMuted, lineHeight: 17 }}>{row.caption}</Text>
              ) : null}
            </View>
          ))
        : null}
    </View>
  );
}
