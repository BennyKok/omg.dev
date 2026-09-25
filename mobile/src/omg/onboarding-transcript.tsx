/**
 * The real session, small, inside step 05's card.
 *
 * Benny was explicit that 05 is the live session and not a picture of one, so
 * this subscribes to the same stream `app/session/[id].tsx` does and renders
 * the same rows. It is READ ONLY: no composer, no queue, no ask center, no
 * scroll-to-bottom button. Those belong to the session screen, and duplicating
 * them here would be a second copy of the hardest code in the app for a card
 * somebody looks at for ten seconds.
 *
 * ── Why not reuse the session screen itself ───────────────────────────────
 *
 * It is a route with a navigator header, a composer bound to the keyboard, and
 * about two thousand lines of state that all assume they own the screen. What
 * is actually shared is the part that matters: `buildTranscriptItems` turns
 * messages into rows and `TranscriptRow` draws them, so both surfaces show the
 * same transcript and keep doing so when that changes.
 *
 * ── It sticks to the bottom ───────────────────────────────────────────────
 *
 * The interesting end of a running session is the newest line. The card starts
 * there and follows new content, and stops following the moment a finger
 * scrolls up, because yanking somebody back to the bottom mid-read is worse
 * than a stale view.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from "react-native";
import type { OmgClient } from "@omg-dev/client";

import { buildTranscriptItems, TranscriptRow, type Entry } from "./transcript";
import { useTheme } from "./theme";
import { settledParagraphs } from "./paragraph-stream";

export function OnboardingTranscript({
  client,
  sessionId,
}: {
  client: OmgClient | null;
  sessionId: string;
}) {
  const { space } = useTheme();
  const [messages, setMessages] = useState<Entry[]>([]);
  const [streamText, setStreamText] = useState("");
  const [busy, setBusy] = useState(true);
  const scroller = useRef<ScrollViewInstance>(null);
  const following = useRef(true);

  useEffect(() => {
    if (!client) return;
    return client.live.subscribeTranscript(sessionId, (event) => {
      switch (event.type) {
        case "snapshot":
          setMessages(event.messages ?? []);
          break;
        case "message":
          setMessages((prev) =>
            // The optimistic-echo dance the session screen does is not needed
            // here: nothing in this card can send, so every message arriving
            // is new. Replacing by id still matters, because a message can be
            // revised after it lands.
            event.message.id && prev.some((m) => m.id === event.message.id)
              ? prev.map((m) => (m.id === event.message.id ? event.message : m))
              : [...prev, event.message],
          );
          setStreamText("");
          break;
        case "draft":
          // Reply deltas only. A streaming THOUGHT is deliberately dropped:
          // in a card this size a paragraph of reasoning pushes the answer off
          // the bottom, and the session screen is where that belongs.
          if (event.draft.kind !== "thinking") setStreamText(settledParagraphs(event.draft.text));
          break;
        case "busy":
          setBusy(event.busy);
          break;
      }
    });
  }, [client, sessionId]);

  const items = useMemo(() => {
    const entries: Entry[] = [...messages];
    if (streamText) entries.push({ id: "__streaming__", role: "assistant", text: streamText, streaming: true });
    return buildTranscriptItems(entries, { busy });
  }, [messages, streamText, busy]);

  useEffect(() => {
    if (following.current) scroller.current?.scrollToEnd({ animated: true });
  }, [items]);

  return (
    <ScrollView
      ref={scroller}
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.md, gap: space.xs }}
      showsVerticalScrollIndicator={false}
      onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        following.current =
          contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
      }}
      scrollEventThrottle={16}
    >
      {items.map((item) => (
        <View key={item.key}>
          {/* `virtualize={false}`: the virtual text body measures against a
              full-height list and collapses to nothing in a short card. */}
          <TranscriptRow item={item} virtualize={false} />
        </View>
      ))}
    </ScrollView>
  );
}
