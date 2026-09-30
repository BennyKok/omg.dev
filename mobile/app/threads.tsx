import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { EmptyState, SessionCard } from "../src/components";
import { relativeTime } from "../src/omg/format";
import { threadPreview } from "../src/omg/threads";
import { useThreads } from "../src/omg/use-threads";
import { useTheme } from "../src/omg/theme";

/**
 * Every thread. Home shows the five most recent as title-only rows and links
 * here with "See more"; this page has the room for each thread's preview.
 */
export default function ThreadsScreen() {
  const router = useRouter();
  const { colors, space } = useTheme();
  const { threads, refresh, archive } = useThreads();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };
  return (
    <ScrollView
      testID="threads-screen"
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingVertical: space.sm }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      {threads.length ? (
        threads.map((thread) => (
          <SessionCard
            key={thread.id}
            sessionId={thread.id}
            title={thread.title}
            subtitle={threadPreview(thread)}
            timestamp={relativeTime(thread.updatedAt)}
            hideAvatar
            onPress={() => router.push(`/thread/${thread.id}`)}
            onArchive={() => archive(thread.id)}
          />
        ))
      ) : (
        <EmptyState title="No threads" />
      )}
    </ScrollView>
  );
}
