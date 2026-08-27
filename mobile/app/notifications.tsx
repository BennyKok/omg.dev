/**
 * The Notification Center: what is waiting on YOU, and what got finished.
 *
 * The web puts these two on one tab for a reason — they are the two ends of
 * the same loop. An agent that asked a question is stopped until you answer,
 * and a shipped post is the receipt for the work that came out. Neither had
 * anywhere to live on the phone, so a question raised while you were away sat
 * unanswered until you happened to open that session.
 *
 * QUESTIONS COME FIRST and always, even when there are none, because "nothing
 * is waiting on you" is itself the answer people open this screen for.
 *
 * Answering is deliberately NOT built here yet. `/api/ask/<id>/answer` takes
 * free text or an option, and a half-built reply box that drops what you typed
 * is worse than a row that takes you to the session where the real composer
 * is. Tapping a question opens its session.
 */

import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { EmptyState, SectionHeader } from "../src/components";
import { AgentAvatar } from "../src/components";
import { useOmg } from "../src/omg/provider";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";
import { PressableScale } from "../src/omg/motion";

type Question = {
  id: string;
  question?: string;
  sessionId?: string | null;
  agent?: string | null;
  createdAt?: number | null;
};

type ShipPost = {
  id: string;
  title?: string;
  summary?: string;
  sessionId?: string | null;
  agent?: string | null;
  ts?: number | null;
};

export default function NotificationsScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const { colors, type, space, radius } = useTheme();
  const { client } = useOmg();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [shipped, setShipped] = useState<ShipPost[]>([]);
  const [pulling, setPulling] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    // Independent reads: a machine with no shipped feed still owes you its
    // open questions.
    const [asks, posts] = await Promise.all([
      client.transport
        .request<{ questions?: Question[] }>("/api/ask?status=open")
        .catch(() => ({ questions: [] })),
      client.transport
        .request<{ posts?: ShipPost[] }>("/api/shipped?limit=20")
        .catch(() => ({ posts: [] })),
    ]);
    setQuestions(asks.questions ?? []);
    setShipped(posts.posts ?? []);
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Notifications", headerLargeTitle: true });
  }, [navigation]);

  const open = (sessionId?: string | null) => {
    if (!sessionId) return;
    router.push(`/session/${sessionId}`);
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: space.xxl }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={() => {
            setPulling(true);
            void load().finally(() => setPulling(false));
          }}
          tintColor={colors.textMuted}
        />
      }
    >
      <SectionHeader
        label="Needs you"
        count={questions.length}
        dotColor={questions.length ? colors.warning : colors.success}
      />
      {questions.length ? (
        <View style={{ gap: space.sm }}>
          {questions.map((question) => (
            <PressableScale
              key={question.id}
              onPress={() => open(question.sessionId)}
              scale={0.98}
              style={{
                flexDirection: "row",
                gap: space.md,
                marginHorizontal: space.lg,
                padding: space.md,
                borderRadius: radius.xl,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                backgroundColor: colors.card,
              }}
            >
              <AgentAvatar agent={question.agent} size={22} plain />
              <Text
                numberOfLines={4}
                style={{ ...type.footnote, color: colors.text, flex: 1, lineHeight: 19 }}
              >
                {(question.question ?? "").trim() || "An agent is waiting"}
              </Text>
            </PressableScale>
          ))}
        </View>
      ) : (
        <EmptyState title="Nothing is waiting on you" detail="Questions from agents land here." />
      )}

      {shipped.length ? (
        <>
          <SectionHeader label="Recently shipped" count={shipped.length} dotColor={colors.success} />
          <View style={{ gap: space.sm }}>
            {shipped.map((post) => (
              <PressableScale
                key={post.id}
                onPress={() => open(post.sessionId)}
                scale={0.98}
                style={{
                  flexDirection: "row",
                  gap: space.md,
                  marginHorizontal: space.lg,
                  padding: space.md,
                  borderRadius: radius.xl,
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                  backgroundColor: colors.card,
                }}
              >
                <AgentAvatar agent={post.agent} size={22} plain />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={2} style={{ ...type.headline, color: colors.text }}>
                    {post.title ?? "Shipped"}
                  </Text>
                  {post.summary ? (
                    <Text
                      numberOfLines={3}
                      style={{ ...type.footnote, color: colors.textMuted, lineHeight: 18 }}
                    >
                      {post.summary}
                    </Text>
                  ) : null}
                </View>
              </PressableScale>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
