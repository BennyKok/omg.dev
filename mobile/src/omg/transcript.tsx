/**
 * The transcript, rendered per message KIND rather than as one stream of prose.
 *
 * The server emits five kinds into a session — `text`, `tool_use`,
 * `tool_result`, `image`, `thinking` — and the screen only ever knew about two
 * of them. Everything else fell through to the assistant branch and was printed
 * as body copy, which is how a phone ended up showing `(thinking)` as a
 * sentence and `mcp__omg__omg_run_auto_agent: { "id": "…" }` as a paragraph.
 * Every kind gets a renderer here, and anything unrecognised still lands on a
 * readable row instead of the empty box attachments used to draw.
 *
 * WHERE THE TOOL PAYLOAD LIVES. `OmgMessage` has no args/input/name-of-tool
 * field, because the server flattens the provider's structured block into the
 * one string it does have. src/sessions.ts (`describeInput`) writes a tool call
 * as `"<toolName>: " + JSON.stringify(input, null, 2)` and a tool result as the
 * result text alone. So the payload is `message.text`, and parsing it back is
 * this module's job — `parseToolCall` is the inverse of that server function.
 *
 * WHY THE ARGUMENTS ARE PARSED AND NOT PRINTED. `JSON.stringify` escapes the
 * newlines *inside* a string value, so a prompt-shaped argument arrives as one
 * enormous line containing literal `\n\n`. Printing `text` verbatim is the bug
 * this module exists to kill: JSON.parse restores the real newlines, and each
 * top-level argument is then handed to `CodeBlock` under its own name.
 *
 * WHY RESULTS ARE PAIRED BY ADJACENCY. The provider's `tool_use_id` does not
 * survive normalization, and neither does `is_error`. Message ids are
 * `<uuid>` / `<uuid>#<blockIndex>` scoped to the turn that carried the block,
 * and a result arrives under a *different* uuid than its call, so there is no
 * id relation to join on — inventing one would be a guess. What is reliable is
 * order: a lone call is immediately followed by its result. So a result is
 * attached only when exactly one call precedes it with no sibling call on
 * either side. A parallel batch (several calls, then several results, in an
 * order nothing here can recover) deliberately leaves them unpaired and shows
 * the results as their own rows rather than labelling one with another's name.
 */

import * as Clipboard from "expo-clipboard";
import MenuView, { type MenuAction } from "@expo/ui/community/menu";
import * as Haptics from "expo-haptics";
import type { AndroidSymbol, SFSymbol } from "expo-symbols";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Reanimated, {
  Easing,
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import type { OmgMessage } from "@omg-dev/protocol";

import { Icon } from "../components";
import { formatFileSize } from "./file-preview";
import { workLabel } from "./work-label";
import { stampTime } from "./format";
import { CodeBlock, Markdown, useBodyText } from "./markdown";
import {
  parseMessageAttachments,
  type MessageAttachment,
} from "./message-attachments";
import { parseOmgPromptEnvelope } from "./omg-prompt-envelope";
import { AuthenticatedImage } from "./remote-image";
import { Text } from "./text";
import { useTheme } from "./theme";

/** A transcript message, plus the flag the live stream sets on its synthetic tail. */
export type Entry = OmgMessage & {
  streaming?: boolean;
  /**
   * Sent with `mode: "queue"` — waiting BEHIND the turn in flight rather than
   * interrupting it. A different fact from `pending`, which means the request
   * itself is still in the air, and it deserves to look different: "Sending…"
   * on a message that will sit untouched for four minutes is a lie about what
   * is happening.
   */
  queued?: boolean;
  /**
   * THE ROW KEY THE MESSAGE WAS BORN WITH. A sent message starts as an
   * optimistic row keyed `local-N`; the machine's echo arrives with the real
   * id. Re-keying the row on that swap unmounted and remounted it, with the
   * arrival animation firing a second time: the "glitch on send". The echo
   * keeps the optimistic key here, so it is the same row settling, not a new
   * one arriving. Set only on confirmed echoes; never persisted.
   */
  localKey?: string;
};

/**
 * A call and the result it produced. Either side can be missing: a call whose
 * result has not landed yet is still worth showing, and a result the pairing
 * rule refused to attach is still worth reading.
 */
type ToolPair = { key: string; call: Entry | null; result: Entry | null };

/**
 * What the list actually renders. Consecutive tool traffic collapses into one
 * `tools` item so a run of calls reads as a tight block of events, not as a
 * column of cards separated by the list's paragraph-sized gap.
 */
export type TranscriptItem =
  | {
      /**
       * A TIME BETWEEN GROUPS, not under every bubble. Messages writes one
       * stamp when a conversation resumes after a pause; a per-message "1h"
       * under each sent bubble said the same thing many times over.
       */
      type: "stamp";
      key: string;
      ts: number;
    }
  | {
      type: "message";
      key: string;
      message: Entry;
      /**
       * When the NEXT thing happened. A thinking block has no duration of its
       * own on the wire, and the honest stand-in is the gap until the agent
       * did the next thing — which is exactly the number a reader wants from
       * it ("how long was it stuck there?").
       */
      nextTs?: number | null;
    }
  | {
      type: "tools";
      key: string;
      pairs: ToolPair[];
      /**
       * Every step of the run in order: the thoughts and the tool calls.
       * `pairs` is the tool subset the sheet's per-step detail is built from.
       */
      entries: Entry[];
      /** When the next thing after the run happened: the run's honest end. */
      nextTs: number | null;
      /** The run at the end of a busy transcript: still going. */
      live: boolean;
    };

/**
 * WHO IS TALKING, for spacing only.
 *
 * The transcript used to put the same gap between every pair of rows, so a
 * six-row answer from one agent was spaced exactly like a change of speaker.
 * Runs read as a list of separate objects rather than one turn. The web fixed
 * this on 2026-08-23 (38a0b1a7e) by spacing rows tightly WITHIN a run and
 * giving the extra air only to a speaker change; this is the same rule.
 *
 * Tool traffic belongs to the agent that ran it, so a tool row does not break
 * the assistant's run. Anything that is neither user nor assistant is its own
 * voice — a system notice interrupting a turn should read as an interruption.
 */
export function transcriptSpeaker(item: TranscriptItem): string {
  if (item.type === "stamp") return "stamp";
  if (item.type === "tools") return "assistant";
  const role = item.message.role;
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return "system";
}

const isCall = (message?: Entry) => message?.kind === "tool_use";
const isResult = (message?: Entry) => message?.kind === "tool_result";

/** Code voice, matching markdown.tsx. Kept local because that module owns its own. */
const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/** How much of an expanded body is worth rendering into a single list cell. */
const BODY_CHAR_LIMIT = 2_000;

/**
 * Attachment tile caps, in points.
 *
 * A lone attachment is usually a screenshot the sender wants to point at, so it
 * gets enough room to be recognisable without taking over a phone screen. The
 * web caps the same tile at 20rem / 15rem; these are the phone's equivalents,
 * smaller because the viewport is.
 */
/**
 * How much of a long sent message stays visible, and what counts as long.
 *
 * The line count is the cap; the character count is the TEST, because
 * `numberOfLines` cannot tell you whether it clipped anything. 460 characters
 * is about ten lines at this width and size — deliberately generous, so the
 * control only appears when there is really something folded away.
 */
const COLLAPSED_LINES = 10;
const LONG_MESSAGE_CHARS = 460;

const ATTACHMENT_MAX = 240;
/** Widest an agent-displayed image gets, whatever the pane offers. */
const DISPLAY_MAX_WIDTH = 560;
const ATTACHMENT_TILE = 150;

const isThought = (message?: Entry) => message?.kind === "thinking";

/** A pause long enough to earn a stamp between groups. Messages uses about an hour; this is a working chat. */
const STAMP_GAP_MS = 15 * 60_000;
const isWork = (message?: Entry) => isCall(message) || isResult(message) || isThought(message);

/**
 * A RUN IS THE THOUGHTS AND THE TOOL CALLS TOGETHER. The agent thinks, calls
 * something, thinks about the result, calls again: one stretch of work, and
 * one row — "Worked for 12s" — that opens into every step. Split by kind it
 * read as "Thought", "2 × shell", "Thought", "1 × shell", none of which say
 * anything until opened. Same rule as the web's buildChatRenderItems.
 *
 * Two exceptions, both because the thought is the only thing on screen:
 *   - a thought with no tool call anywhere near it stays a row of its own;
 *   - the thought still streaming at the END of the transcript stays out of
 *     the run above it, so the live reasoning is readable without a tap.
 *
 * `busy` marks the run at the end of the transcript as live: its label counts
 * up until the agent moves on.
 */
export function buildTranscriptItems(
  messages: Entry[],
  options: { busy?: boolean } = {},
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let index = 0;
  let lastStampTs: number | null = null;

  /** One stamp per pause: the first row, then any row more than STAMP_GAP_MS after the last stamp. */
  const stamp = (ts: number | null | undefined, key: string) => {
    if (!ts) return;
    if (lastStampTs !== null && ts - lastStampTs < STAMP_GAP_MS) return;
    lastStampTs = ts;
    items.push({ type: "stamp", key: `stamp-${key}`, ts });
  };

  const pushMessage = (message: Entry, at: number) => {
    const key = entryKey(message, at);
    stamp(message.ts, key);
    items.push({
      type: "message",
      key,
      message,
      nextTs: messages[at + 1]?.ts ?? null,
    });
  };

  while (index < messages.length) {
    const message = messages[index];
    // Claude's steering marker carries no words a person wrote. It used to be
    // an "Interrupted" line; now it is not a row at all.
    if (isInterruptedTurn(message)) {
      index += 1;
      continue;
    }
    if (!isWork(message)) {
      pushMessage(message, index);
      index += 1;
      continue;
    }
    let end = index;
    while (end < messages.length && isWork(messages[end])) end += 1;
    /**
     * EVERY STRETCH OF WORK IS ONE ROW, whatever it holds. A lone thought,
     * a single tool call, a thought still streaming at the end: they used
     * to stay out as rows of their own, so a turn read "Thinking", "Bash",
     * "Thinking", "Working" down the screen. One "Working for 12s" row
     * now, opening into every step; the footer shows only when there is no
     * live run to say it.
     */
    const run = messages.slice(index, end);
    const tools = run.filter((entry) => !isThought(entry));
    stamp(message.ts, `tools-${entryKey(message, index)}`);
    items.push({
      type: "tools",
      key: `tools-${entryKey(message, index)}`,
      pairs: buildToolPairs(tools, index),
      entries: run,
      nextTs: messages[end]?.ts ?? null,
      live: !!options.busy && end === messages.length,
    });
    index = end;
  }

  return items;
}

/** See the file header: adjacency only, and only when the call stands alone. */
function buildToolPairs(run: Entry[], offset: number): ToolPair[] {
  const pairs: ToolPair[] = [];
  for (let i = 0; i < run.length; i += 1) {
    const message = run[i];
    const key = entryKey(message, offset + i);
    if (!isCall(message)) {
      pairs.push({ key, call: null, result: message });
      continue;
    }
    const solitary = !isCall(run[i - 1]) && !isCall(run[i + 1]);
    if (solitary && isResult(run[i + 1])) {
      pairs.push({ key, call: message, result: run[i + 1] });
      i += 1;
      continue;
    }
    pairs.push({ key, call: message, result: null });
  }
  return pairs;
}

/** Ids are nullable on the wire, so position is the fallback that keeps keys unique. */
function entryKey(message: Entry, index: number): string {
  return message.localKey ?? message.id ?? `${message.kind ?? message.role ?? "msg"}-${index}`;
}

/**
 * ROWS ARRIVE, THEY DO NOT APPEAR.
 *
 * A message that pops into existence at full size is the difference between a
 * transcript and a chat. iMessage slides a sent bubble up from the composer;
 * everything here — your message, the agent's reply, a tool badge — enters the
 * same way, from slightly below and slightly transparent, on a spring short
 * enough that it never delays reading.
 *
 * `entering` is passed ONLY for rows that arrived after the screen settled
 * (see `fresh`): without that guard the whole first page animates in on open,
 * which is eighty springs at once and looks like the app is loading rather
 * than the conversation continuing.
 *
 * `layout` is what makes the rest of the list move rather than jump when a row
 * above it grows — a streaming reply gaining a paragraph, a thinking block
 * resolving into text.
 */
export function TranscriptRow({
  item,
  fresh,
  bot,
}: {
  item: TranscriptItem;
  fresh?: boolean;
  /** Present only inside a bot chat — see app/session/[id].tsx's `SessionScreenBody`. */
  bot?: BotBubbleIdentity | null;
}) {
  return (
    <Reanimated.View
      // Eased, not sprung. The spring overshot on arrival and on every
      // layout change, so a new row and everything under it visibly
      // wobbled — it read as a shake, not an arrival.
      entering={
        fresh
          ? item.type === "message" && item.message.role === "user"
            ? // A SENT MESSAGE RISES OUT OF THE COMPOSER: it starts low and a
              // touch small, where the field is, and settles into its slot,
              // so the words you just typed travel to where they now live
              // instead of appearing there.
              FadeInDown.duration(300)
                .easing(Easing.out(Easing.cubic))
                .withInitialValues({ opacity: 0.4, transform: [{ translateY: 72 }] })
            : FadeInDown.duration(180).easing(Easing.out(Easing.cubic))
          : undefined
      }
      layout={LinearTransition.duration(160).easing(Easing.out(Easing.quad))}
    >
      {item.type === "stamp" ? (
        <Stamp ts={item.ts} />
      ) : item.type === "message" ? (
        <TranscriptEntry message={item.message} nextTs={item.nextTs} bot={bot} />
      ) : (
        <ToolRun pairs={item.pairs} entries={item.entries} nextTs={item.nextTs} live={item.live} />
      )}
    </Reanimated.View>
  );
}

/** The centred time between groups of rows. */
function Stamp({ ts }: { ts: number }) {
  const { colors, type, space } = useTheme();
  return (
    <View style={{ alignSelf: "stretch", alignItems: "center", paddingVertical: space.sm }}>
      <Text style={{ ...type.caption, color: colors.textMuted }}>{stampTime(ts)}</Text>
    </View>
  );
}

/** The little a bot bubble needs to know — not the whole `Bot` record, so
 * this module does not have to import bots.ts for a shape/colorway it
 * already has no use for on a settled bubble (that's carried on the working
 * indicator instead — see app/session/[id].tsx's `BotWorkingIndicator`). */
export type BotBubbleIdentity = { id: string };

/**
 * A RUN COLLAPSES TO ONE BADGE — "4 tool calls" — and opens into the four.
 *
 * A single answer routinely does eight or ten things, and even as compact
 * badges that is ten chips of scaffolding wedged between two paragraphs of the
 * reply you were reading. The run is one unit of work, so it gets one line
 * until you ask; the badges then behave exactly as they did, each opening to
 * its own arguments.
 *
 * A lone call is NOT wrapped. Hiding one thing behind a disclosure that says
 * "1 tool call" is strictly more work than showing it.
 */
/**
 * The drawer every tool payload opens in — one place, so a single call and a
 * whole run present identically. A sheet is what iOS uses for "show me this
 * one thing without losing where I was", which is precisely the job.
 */
function ToolSheet({
  visible,
  title,
  symbol,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  symbol: Symbols;
  onClose: () => void;
  children: ReactNode;
}) {
  const { colors, type, space } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
          }}
        >
          <Icon ios={symbol.ios} android={symbol.android} size={14} color={colors.textMuted} />
          <Text style={{ ...type.headline, color: colors.text, flex: 1 }} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Icon ios="xmark" android="close" size={15} color={colors.textSecondary} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.sm }}
          contentInsetAdjustmentBehavior="never"
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Three dots breathing in sequence: the one animation everybody reads as "something is coming". */
function WorkingDots({ color }: { color: string }) {
  const dots = useRef([new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]).current;
  useEffect(() => {
    const loops = dots.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(value, { toValue: 1, duration: 340, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.3, duration: 340, useNativeDriver: true }),
          Animated.delay((dots.length - 1 - i) * 160),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginRight: 2 }}>
      {dots.map((value, i) => (
        <Animated.View
          key={i}
          style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color, opacity: value }}
        />
      ))}
    </View>
  );
}

/** One call's arguments and result, as the blocks a reader can copy. */
function ToolDetail({ call, result }: { call: Entry | null; result: Entry | null }) {
  const { colors, type, space } = useTheme();
  const parsed = useMemo(() => (call ? parseToolCall(call.text) : null), [call]);
  const resultText = useMemo(() => (result?.text ?? "").trim(), [result]);
  const failed = useMemo(() => looksFailed(resultText), [resultText]);
  const summary = parsed?.summary ?? null;

  return (
    <View style={{ gap: space.sm }}>
      {summary ? (
        <Text style={{ ...type.caption, color: colors.textMuted }}>{summary}</Text>
      ) : null}
      {parsed?.fields.map((field) => (
        <CodeBlock key={field.key} text={clip(field.value)} lang={field.key} />
      ))}
      {parsed?.raw ? <CodeBlock text={clip(parsed.raw)} lang={parsed.rawLabel} /> : null}
      {resultText ? <CodeBlock text={clip(resultText)} lang={failed ? "error" : "result"} /> : null}
    </View>
  );
}

function ToolRun({
  pairs,
  entries,
  nextTs,
  live,
}: {
  pairs: ToolPair[];
  entries: Entry[];
  nextTs: number | null;
  live: boolean;
}) {
  const { colors, type, space } = useTheme();
  const [open, setOpen] = useState(false);

  const names = useMemo(
    () =>
      pairs
        .map((pair) => (pair.call ? parseToolCall(pair.call.text)?.name : null))
        .filter((name): name is string => !!name),
    [pairs],
  );
  const unique = useMemo(() => [...new Set(names)], [names]);
  const thoughts = useMemo(() => entries.filter(isThought), [entries]);

  // A live run counts up once a second; a finished one is a fixed number.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);


  // The row says how long; the sheet says what. "Thought · 4 × shell" is the
  // sheet's title, the same summary the web's popover carries.
  const label = workLabel(entries, { live, now, endTs: nextTs });
  const toolSummary =
    unique.length === 1 ? `${pairs.length} × ${unique[0]}` : `${pairs.length} tool calls`;
  const summary = [
    thoughts.length ? (thoughts.length === 1 ? "Thought" : `${thoughts.length} thoughts`) : null,
    pairs.length ? toolSummary : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // The sheet's title still carries the tool's mark; only the row lost it.
  const symbol: Symbols =
    unique.length === 1 ? toolSymbol(unique[0]) : { ios: "wrench.and.screwdriver", android: "build" };

  /**
   * ONE TAP, ONE DRAWER. The run used to unfold into its badges, which meant
   * two taps and a transcript that grew a list mid-sentence before you could
   * read anything. Everything the run did is in the sheet, in order.
   */
  const openSheet = () => {
    void Haptics.selectionAsync();
    setOpen(true);
  };

  return (
    <View style={{ alignSelf: "stretch" }}>
      <Pressable
        onPress={openSheet}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${summary}. Open`}
        /**
         * NO PILL. A tool call is a line in the transcript, not a card in it.
         * The border and the card fill gave every "2 Bash" the same visual
         * weight as a message, and a turn with six of them read as six objects
         * stacked between the sentences. The web dropped the capsule for this
         * reason on 2026-08-22 (0e9e5fbac, `.tool-call-row`); this is the same
         * change on the phone.
         *
         * Pressed state moves to the LABEL's colour rather than a fill, since
         * there is no longer a surface to tint.
         */
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          minHeight: 26,
          // Only enough inset to keep the row's own touch target honest.
          paddingHorizontal: space.xs,
          paddingVertical: 3,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {/* No tool glyph at the head of the row: the label already says what
            kind of row this is, and the mark was one more thing in the
            gutter. A LIVE run carries the breathing dots instead — the same
            ones the footer used to show on its own — so the run row is the
            working indicator, not a second one under it. */}
        {live ? <WorkingDots color={colors.textSecondary} /> : null}
        <Text style={{ ...type.caption, fontWeight: "500", color: colors.textSecondary }}>{label}</Text>
        <Icon ios="chevron.right" android="chevron_right" size={10} color={colors.textMuted} />
      </Pressable>

      <ToolSheet
        visible={open}
        title={summary || label}
        symbol={symbol}
        onClose={() => setOpen(false)}
      >
        {/* Every step in the order it happened, thoughts included: a run of
            five shells is five different commands, and the reasoning between
            them is why the fourth differs from the third. */}
        {(() => {
          let toolIndex = -1;
          const consumed = new Set<string>();
          return entries.map((entry, index) => {
            if (isThought(entry)) {
              const body = (entry.text ?? "").trim();
              if (!body || body === "(thinking)") return null;
              return (
                <View key={entryKey(entry, index)} style={{ gap: space.xs }}>
                  <Text style={{ ...type.caption, color: colors.textMuted }}>Thought</Text>
                  <Text selectable style={{ ...type.footnote, lineHeight: 19, color: colors.textSecondary }}>
                    {body}
                  </Text>
                </View>
              );
            }
            // A result the pairing rule attached to its call was already drawn
            // with that call; a call or lone result is the next step.
            const pair = pairs.find(
              (candidate) =>
                !consumed.has(candidate.key) &&
                (candidate.call === entry || candidate.result === entry),
            );
            if (!pair || (pair.call && pair.call !== entry)) return null;
            consumed.add(pair.key);
            toolIndex += 1;
            return (
              <View key={pair.key} style={{ gap: space.sm }}>
                <ToolStepHeader call={pair.call} result={pair.result} index={toolIndex} />
                <ToolDetail call={pair.call} result={pair.result} />
              </View>
            );
          });
        })()}
      </ToolSheet>
    </View>
  );
}

/** The name, number and outcome of one step inside a run's sheet. */
function ToolStepHeader({
  call,
  result,
  index,
}: {
  call: Entry | null;
  result: Entry | null;
  index: number;
}) {
  const { colors, type, space } = useTheme();
  const parsed = call ? parseToolCall(call.text) : null;
  const resultText = (result?.text ?? "").trim();
  const failed = looksFailed(resultText);
  const symbol = parsed ? toolSymbol(parsed.name) : { ios: "checkmark.circle" as const, android: "check_circle" as const };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingTop: index === 0 ? 0 : space.md,
      }}
    >
      <Icon ios={symbol.ios} android={symbol.android} size={12} color={colors.textMuted} />
      <Text style={{ ...type.caption, fontWeight: "600", color: colors.text }}>
        {parsed?.name ?? "Result"}
      </Text>
      {resultText ? (
        <Text style={{ ...type.caption, fontSize: 10, color: failed ? colors.danger : colors.textMuted }}>
          {failed ? "Failed" : "Done"}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Claude records STEERING as a synthetic user turn — `[Request interrupted by
 * user]` — and this screen was drawing it as a message the human typed: a full
 * card, quoting a sentence nobody wrote, sitting where their words go. The web
 * keeps the row (it carries the ordering) and reduces it to a status line; this
 * is the same rule, matched to `isRequestInterruptedMessage` in
 * web/src/lib/transcript-status.ts so the two cannot drift.
 */
function isInterruptedTurn(message: Entry): boolean {
  if (message.role !== "user") return false;
  return /^\[Request interrupted by user(?: for tool use)?\]$/i.test((message.text ?? "").trim());
}

export function TranscriptEntry({
  message,
  nextTs,
  bot,
}: {
  message: Entry;
  nextTs?: number | null;
  bot?: BotBubbleIdentity | null;
}) {
  const { colors, type, space, radius } = useTheme();
  const isUser = message.role === "user";

  // buildTranscriptItems drops these; this guards a caller that did not go through it.
  if (isInterruptedTurn(message)) return null;
  const isSystem = message.role !== "user" && message.role !== "assistant";

  // A message carrying only a file or an image has no text to fall back on, and
  // used to render as an empty box — an invisible turn in the transcript. One
  // that ALSO has text still renders as text, so nothing a person wrote or read
  // can be swallowed by this branch.
  /**
   * AN AGENT'S OWN SCREENSHOT IS THE MESSAGE, not an attachment to one.
   *
   * `omg_display_image` posts a message of kind `image` carrying the artifact
   * url — and a caption, which arrives in `text`. That caption was the bug:
   * every branch below that could have drawn the picture was guarded by
   * `!message.text`, so a displayed image fell through to the prose renderer
   * and became a single grey line of caption with nothing above it. An agent
   * that took a screenshot to SHOW you something showed you a sentence about
   * it instead.
   *
   * It draws at the column's full width rather than at attachment-tile size:
   * this is evidence the agent chose to put in front of you — a diff, a
   * dashboard, a screen it just fixed — and a 240pt thumbnail of a phone
   * screenshot is unreadable. Tapping still opens it full-bleed.
   */
  if (message.kind === "image" && (message.url || message.artifactId)) {
    return <DisplayedImage message={message} />;
  }

  // A displayed file is an artifact, never prose. Its caption arrives in
  // `text`, and the `!message.text` guard below therefore used to let it fall
  // all the way through to the markdown renderer — so an agent that handed you
  // a PDF handed you a grey sentence about a PDF instead. That is the same bug
  // `DisplayedImage` above exists to fix, and it is one branch earlier here.
  if (message.kind === "file" && (message.url || message.artifactId)) {
    return <FileEntry message={message} />;
  }

  const isAttachment =
    !!message.url || !!message.artifactId || message.kind === "image" || message.kind === "file";
  if (isAttachment && !message.text) return <AttachmentEntry message={message} />;

  if (message.kind === "thinking") return <ThinkingEntry message={message} nextTs={nextTs} />;

  // A result that reached here escaped the pairing pass (see the file header).
  if (message.kind === "tool_result") return <ToolEntry call={null} result={message} />;
  if (message.kind === "tool_use") return <ToolEntry call={message} result={null} />;

  if (isUser) return <UserMessage message={message} />;

  if (!message.text?.trim()) {
    // Never an empty cell: say what arrived, even when this build cannot draw it.
    if (isSystem) return null;
    return <FallbackEntry message={message} />;
  }

  if (isSystem) {
    return (
      <View style={{ alignSelf: "center", paddingHorizontal: space.lg }}>
        <Text style={{ ...type.caption, color: colors.textMuted, textAlign: "center" }}>
          {message.text}
        </Text>
      </View>
    );
  }

  // A bot's reply gets a bubble — spec §4.2, and the point of bot chat at
  // all: it should read as talking to somebody, not as a session log. Card
  // shell + taller corner (matches the web's shipped `rounded-[18px]
  // border-border bg-card px-3.5 py-2.5`, radius.xl already being that same
  // 18 — see palette.ts), capped at 84% of the stream. No avatar on the
  // bubble itself: the web's shipped behavior (App.tsx's `TypingIndicator`)
  // moved the bot's face to the ONE place it earns its space — the working
  // indicator, app/session/[id].tsx's `BotWorkingIndicator` — after finding
  // on-device that a face beside every settled reply reads as several
  // speakers, not one bot saying several things. See bot-transcript.ts's own
  // header for that same "shipped code over spec.md" note.
  if (bot) {
    return (
      <View
        style={{
          alignSelf: "flex-start",
          maxWidth: "84%",
          borderRadius: radius.xl,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: colors.card,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Markdown text={message.text ?? ""} streaming={message.streaming} />
      </View>
    );
  }

  // The assistant's reply is plain text on the page background — no card, no
  // tint — exactly like the web transcript.
  return (
    <View style={{ alignSelf: "stretch", paddingHorizontal: space.xs }}>
      <Markdown text={message.text ?? ""} streaming={message.streaming} />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Tool calls                                                                  */
/* -------------------------------------------------------------------------- */

type ToolField = { key: string; value: string };

type ParsedCall = {
  /** Display name, with the MCP server segment dropped. */
  name: string;
  /** One line of "what is it doing", or null when the call carried no input. */
  summary: string | null;
  /** Top-level arguments, in payload order, with real newlines restored. */
  fields: ToolField[];
  /** Set when the payload was not a JSON object and has to be shown as-is. */
  raw: string | null;
  /** What `raw` actually is. Codex writes a call's OUTPUT where a name:JSON call keeps its input. */
  rawLabel: "input" | "output";
};

/**
 * A tool call, as one row: symbol, name, and what it is doing. Tapping opens
 * the arguments and the result. Collapsed is the default because ten of these
 * between two paragraphs of answer is the common case, and an agent's tool
 * traffic is context, not content.
 */
function ToolEntry({ call, result }: { call: Entry | null; result: Entry | null }) {
  const { colors, type, space, radius, motion } = useTheme();
  const [open, setOpen] = useState(false);
  const turn = useSharedValue(0);

  const parsed = useMemo(() => (call ? parseToolCall(call.text) : null), [call]);
  const resultText = useMemo(() => (result?.text ?? "").trim(), [result]);
  const failed = useMemo(() => looksFailed(resultText), [resultText]);

  const chevron = useAnimatedStyle(() => ({
    // 180°, not 90°: it rests pointing DOWN like the web's ChevronDown and
    // flips to point up when the panel opens.
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));

  const expandable = !!parsed?.fields.length || !!parsed?.raw || !!resultText;

  const toggle = () => {
    if (!expandable) return;
    void Haptics.selectionAsync();
    setOpen(true);
  };

  const close = () => setOpen(false);

  // A result the pairing pass could not attach has no tool to name a symbol
  // after, so it wears its own outcome instead of a generic wrench.
  const symbol: Symbols = parsed
    ? toolSymbol(parsed.name)
    : failed
      ? { ios: "exclamationmark.triangle", android: "error" }
      : { ios: "checkmark.circle", android: "check_circle" };
  const title = parsed?.name ?? "Result";
  // A result with no call of its own still needs a one-line preview, or the row
  // says nothing at all until it is opened.
  const summary = parsed?.summary ?? (parsed ? null : oneLine(resultText || "(result)"));

  return (
    <View
      /**
       * EACH CALL IS ITS OWN BOX, matching the web's Tool component
       * (`rounded-lg border border-border/80`, header `px-3 py-2`, content
       * behind a top border). This spent a version as one merged card with
       * shared hairlines; that is not what the other surface draws, and a
       * session read differently depending which one you opened it on.
       */
      /**
       * COLLAPSED, IT IS A BADGE — a small rounded rectangle that says which
       * tool ran and nothing else, sized to its own name rather than to the
       * screen. Eight steps of a run then read as eight quiet chips under the
       * sentence that explains them, instead of eight full-width panels each
       * repeating a command nobody asked to see yet.
       *
       * Opening it is what asks to see it: the box stretches, the arguments
       * and the result appear, and the badge becomes the header of that panel.
       */
      /**
       * NO PILL, collapsed or open. Same call as ToolRun above: a tool call
       * is a line in the transcript, not a card in it. Opened, the
       * arguments and result get their own inset panel below the row.
       */
      style={{
        alignSelf: "flex-start",
        maxWidth: "100%",
        overflow: "hidden",
      }}
    >
      <Pressable
        onPress={toggle}
        disabled={!expandable}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}${summary ? `, ${summary}` : ""}`}
        accessibilityHint={expandable ? "Shows the arguments and the result" : undefined}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          minHeight: 26,
          paddingHorizontal: space.sm,
          paddingVertical: 3,
          backgroundColor: pressed ? colors.cardPressed : "transparent",
        })}
      >
        <Icon ios={symbol.ios} android={symbol.android} size={12} color={colors.textMuted} />
        <Text
          numberOfLines={1}
          style={{
            ...type.caption,
            fontWeight: "500",
            color: colors.text,
            flexShrink: 1,
          }}
        >
          {title}
        </Text>
        {/**
         * The web states the outcome in words on a badge, and this says it the
         * same way — but ONLY when it is known.
         *
         * A call with no result attached is not a call that is running. See
         * this file's header: `tool_use_id` does not survive normalization, so
         * a PARALLEL batch is deliberately left unpaired, and every one of
         * those finished long ago. A "Running" badge on them was this screen
         * inventing a status out of the absence of one — four completed shells
         * all claiming to be in flight. Silence is the honest answer to a
         * question the data cannot answer.
         */}
        {result ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 3,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: radius.sm,
              backgroundColor: colors.secondary,
            }}
          >
            <Icon
              ios={failed ? "xmark.circle.fill" : "checkmark.circle.fill"}
              android={failed ? "cancel" : "check_circle"}
              size={10}
              color={failed ? colors.danger : colors.textMuted}
            />
            <Text
              style={{
                ...type.caption,
                fontSize: 10,
                color: failed ? colors.danger : colors.textMuted,
              }}
            >
              {failed ? "Failed" : "Done"}
            </Text>
          </View>
        ) : null}
        {/* The summary is the first line of the CONTENT, so it waits for the
            same tap the arguments do. Collapsed, the badge says which tool —
            that is the whole point of it being a badge. */}

        {/* Chevron on the TRAILING edge, pointing down and rotating on open —
            the web's `ChevronDown ... group-data-[panel-open]/tool:rotate-180`.
            It used to lead the row, which put the least important thing first. */}
        {/* A chevron that opens a SHEET points forward, not down: down means
            "this grows in place", which is exactly what it stopped doing. */}
        <Icon
          ios="chevron.right"
          android="chevron_right"
          size={10}
          color={expandable ? colors.textMuted : "transparent"}
        />
      </Pressable>

      {/**
       * THE DETAIL OPENS AS A SHEET, not inline. A tool's arguments are
       * frequently longer than the screen — a diff, a file, a page of JSON —
       * and expanding that between two paragraphs pushed the conversation you
       * were reading off the top.
       */}
      <ToolSheet visible={open} title={title} symbol={symbol} onClose={close}>
        <ToolDetail call={call} result={result} />
      </ToolSheet>
    </View>
  );
}

/**
 * `"<name>: <input>"` back into its parts.
 *
 * Only the FIRST line is searched for the name separator: the Claude path
 * pretty-prints its JSON across many lines, so everything after that first
 * newline belongs to the payload. Codex writes a shell call as `$ <command>`
 * followed by its output and never uses the `name:` shape at all, so a
 * candidate that is not identifier-shaped is treated as the summary itself
 * rather than being forced into a name.
 */
export function parseToolCall(text?: string): ParsedCall {
  const raw = (text ?? "").trim();
  if (!raw) return { name: "tool", summary: null, fields: [], raw: null, rawLabel: "input" };

  const newline = raw.indexOf("\n");
  const head = newline >= 0 ? raw.slice(0, newline) : raw;
  const rest = newline >= 0 ? raw.slice(newline + 1) : "";
  const separator = head.indexOf(":");
  const candidate = (separator >= 0 ? head.slice(0, separator) : head).trim();

  if (/^[A-Za-z_][\w.$-]*$/.test(candidate)) {
    const headPayload = separator >= 0 ? head.slice(separator + 1).trim() : "";
    const payload = [headPayload, rest].filter(Boolean).join("\n");
    const { fields, raw: leftover } = parsePayload(payload);
    // Codex writes `web_search: <query>` and then pastes the RESULTS underneath,
    // so flattening the whole payload into the summary describes the answer
    // instead of the question. When the payload never parsed as JSON, the first
    // line is the call; the rest is what came back.
    const headSummary = leftover && headPayload && !/^[{[]/.test(headPayload) ? headPayload : null;
    return {
      name: displayName(candidate),
      summary: headSummary ? oneLine(headSummary) : summarize(fields, leftover),
      fields,
      raw: leftover,
      rawLabel: headSummary ? "output" : "input",
    };
  }

  // `$ git status` + output, and anything else that never had a name.
  const shell = head.startsWith("$ ");
  const { fields, raw: leftover } = parsePayload(rest);
  return {
    name: shell ? "shell" : "tool",
    summary: oneLine(shell ? head.slice(2) : head),
    fields,
    raw: leftover,
    rawLabel: "output",
  };
}

/**
 * The escaped-newline fix. `JSON.parse` is what turns `"a\\n\\nb"` back into
 * two paragraphs; splitting the object into one block per argument is what
 * keeps a long `content` string from burying the `file_path` next to it.
 */
function parsePayload(payload: string): { fields: ToolField[]; raw: string | null } {
  const trimmed = payload.trim();
  if (!trimmed) return { fields: [], raw: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Not JSON — a bare string argument, or a payload the server truncated
    // mid-object. Unescape by hand so the literal `\n` still stops being one.
    return { fields: [], raw: unescape(trimmed) };
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const fields = Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => ({ key, value: renderValue(value) }))
      .filter((field) => field.value.length > 0);
    return fields.length ? { fields, raw: null } : { fields: [], raw: null };
  }

  return { fields: [], raw: renderValue(parsed) };
}

function renderValue(value: unknown): string {
  // A string value is returned as itself: JSON.parse has already restored its
  // newlines, and re-stringifying would escape them right back.
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function unescape(text: string): string {
  if (!text.includes("\\n") && !text.includes("\\t")) return text;
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * The keys agents actually put the subject of the call in, most specific
 * first. `Bash` says `command`, `Read` says `file_path`, `Grep` says `pattern`
 * — reading one of them beats reading `{"id":"…"}`.
 */
const SUMMARY_KEYS = [
  "command",
  "file_path",
  "filePath",
  "path",
  "pattern",
  "query",
  "url",
  "prompt",
  "description",
  "title",
  "name",
  "id",
  "text",
  "message",
  "content",
];

function summarize(fields: ToolField[], raw: string | null): string | null {
  for (const key of SUMMARY_KEYS) {
    const match = fields.find((field) => field.key.toLowerCase() === key.toLowerCase());
    if (match) return oneLine(match.value);
  }
  if (fields.length) return oneLine(fields[0].value);
  return raw ? oneLine(raw) : null;
}

function oneLine(text: string, max = 72): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The expanded body lives in one list cell; the server already caps it at 8k. */
function clip(text: string): string {
  if (text.length <= BODY_CHAR_LIMIT) return text;
  const omitted = text.length - BODY_CHAR_LIMIT;
  return `${text.slice(0, BODY_CHAR_LIMIT)}\n\n…${omitted.toLocaleString()} more characters`;
}

/**
 * `mcp__omg__omg_run_auto_agent` is the wire name. The server segment is the
 * least useful third of it on a 390pt screen, and the verb is what identifies
 * the call, so only the last segment is shown.
 */
function displayName(name: string): string {
  const parts = name.split("__").filter(Boolean);
  return parts[parts.length - 1] || name;
}

/**
 * Outcome without a flag to read.
 *
 * The provider's `is_error` does not survive normalization, so the text is the
 * only signal left. The test is deliberately anchored to the START of the
 * output: agents quote the word "error" in successful greps and file reads all
 * day, and painting those rows red would make the colour worthless.
 */
function looksFailed(text: string): boolean {
  if (!text) return false;
  const head = text.slice(0, 120).trimStart().toLowerCase();
  return (
    head.startsWith("<tool_use_error>") ||
    head.startsWith("error") ||
    head.startsWith("exception") ||
    head.startsWith("traceback") ||
    head.startsWith("failed") ||
    head.startsWith("fatal:") ||
    head.startsWith("command failed")
  );
}

type Symbols = { ios: SFSymbol; android: AndroidSymbol };

/**
 * A symbol per family of tool. Matched on substrings because the same verbs
 * arrive under many names — `Bash`, `shell`, `command_execution`, and an MCP
 * server's `omg__run_command` all mean the same thing to a reader.
 */
function toolSymbol(name: string): Symbols {
  const key = name.toLowerCase();
  const has = (...needles: string[]) => needles.some((needle) => key.includes(needle));

  if (has("bash", "shell", "command", "terminal", "exec", "run")) {
    return { ios: "terminal", android: "terminal" };
  }
  if (has("grep", "search", "glob", "find")) {
    return { ios: "magnifyingglass", android: "search" };
  }
  if (has("write", "create")) return { ios: "square.and.pencil", android: "edit_square" };
  if (has("edit", "patch", "apply", "replace")) return { ios: "pencil", android: "edit" };
  if (has("read", "cat", "view", "notebook")) return { ios: "doc.text", android: "description" };
  if (has("ls", "list", "tree", "dir", "folder")) return { ios: "folder", android: "folder" };
  if (has("web", "fetch", "http", "url", "browser")) return { ios: "globe", android: "public" };
  if (has("todo", "task", "plan")) return { ios: "checklist", android: "checklist" };
  if (has("agent", "subagent", "delegate", "session")) {
    return { ios: "person.2", android: "group" };
  }
  if (has("image", "photo", "video", "display", "artifact")) {
    return { ios: "photo", android: "image" };
  }
  return { ios: "wrench.and.screwdriver", android: "build" };
}

/* -------------------------------------------------------------------------- */
/* Thinking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reasoning, marked as subordinate to the answer.
 *
 * It is dimmed, it is one line until it is asked for, and it sits behind a rule
 * down its left edge so the eye can skip the whole column. It used to render at
 * full body weight in the same voice as the reply, which made the agent look
 * like it was answering twice.
 */
function ThinkingEntry({ message, nextTs }: { message: Entry; nextTs?: number | null }) {
  const { colors, type, space, motion } = useTheme();
  const [open, setOpen] = useState(false);

  const text = (message.text ?? "").trim();
  // The normalizer substitutes the literal "(thinking)" when the provider
  // redacted the block. There is a turn to acknowledge and nothing to open.
  const body = text === "(thinking)" ? "" : text;

  /**
   * "Thought for 12s". Only when the gap is BELIEVABLE: a block that is still
   * the last thing in the transcript has no end yet, and a session resumed
   * hours later would otherwise claim the agent thought all night. Under a
   * second is not worth saying.
   */
  const thoughtFor = useMemo(() => {
    if (!message.ts || !nextTs) return null;
    const ms = nextTs - message.ts;
    if (ms < 1000 || ms > 15 * 60_000) return null;
    return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
  }, [message.ts, nextTs]);

  const toggle = () => {
    if (!body) return;
    void Haptics.selectionAsync();
    setOpen((value) => !value);
  };

  return (
    /**
     * NO RULE DOWN THE SIDE. The indent said "this is quoted from somewhere",
     * which is not what a thinking block is — it is the agent's own working,
     * and it already reads as an aside by being collapsed and muted. What was
     * missing is the fact people actually want from it: HOW LONG it thought.
     */
    <View style={{ alignSelf: "stretch", gap: space.xs }}>
      <Pressable
        onPress={toggle}
        disabled={!body}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Thinking"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          minHeight: 28,
          opacity: pressed ? 0.5 : 1,
        })}
      >
        {/* The row starts with its own glyph, flush with everything else in
            the transcript. A chevron in FRONT of it was a 14pt indent applied
            to one kind of row, which is the padding that made this block look
            like it had been quoted from somewhere. */}
        <Icon ios="brain" android="psychology" size={12} color={colors.textMuted} />
        <Text style={{ ...type.caption, color: colors.textMuted }}>
          {thoughtFor ? `Thought for ${thoughtFor}` : "Thinking"}
        </Text>
        {/* No chevron. The row is the whole trigger and the words already
            read as a disclosure; the collapsed preview beside them says there
            is something to open. Same call as the web transcript. */}
        {body && !open ? (
          <Text
            numberOfLines={1}
            style={{ ...type.caption, color: colors.textMuted, flex: 1, minWidth: 0 }}
          >
            {oneLine(body, 60)}
          </Text>
        ) : null}
      </Pressable>

      {open && body ? (
        <Reanimated.View entering={FadeIn.duration(motion.quick)} style={{ paddingBottom: space.xs }}>
          <Text selectable style={{ ...type.footnote, lineHeight: 19, color: colors.textMuted }}>
            {body}
          </Text>
        </Reanimated.View>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Attachments, prose, and the catch-all                                       */
/* -------------------------------------------------------------------------- */

/**
 * A picture an agent put in the conversation, with its caption under it.
 *
 * The caption is styled as a caption — muted, small, under the image — rather
 * than as the assistant's prose, because that is what it is: a line naming
 * what you are looking at. Rendering it in body text (which is what happened
 * before this existed) made the sentence the message and the image nothing.
 *
 * The height cap is deliberate and generous. Screenshots from this product are
 * usually PHONE screenshots — 1206x2622, taller than they are wide — and a
 * square cap would show a third of one. 420pt is about as much vertical room
 * as can be given up without the transcript becoming a photo album.
 */
/**
 * The artifact's own pixel dimensions, when it sent them.
 *
 * `OmgMessage` does not declare `width`/`height` — the protocol package
 * predates artifacts carrying them — but the server puts them on the wire for
 * every image message. Reading them through a narrow cast is honest about
 * that gap; widening the shared type is the real fix and belongs in the
 * protocol package, not here.
 */
function artifactRatio(message: Entry): number | null {
  const { width, height } = message as Entry & { width?: number; height?: number };
  if (typeof width !== "number" || typeof height !== "number" || height <= 0) return null;
  return width / height;
}

function DisplayedImage({ message }: { message: Entry }) {
  const { colors, type, space, radius } = useTheme();
  const screen = useWindowDimensions();
  const caption = (message.caption ?? message.text ?? message.alt ?? "").trim();
  const path = message.url ?? (message.artifactId ? `/api/artifacts/${message.artifactId}` : null);
  if (!path) return <AttachmentEntry message={message} />;

  return (
    <View style={{ alignSelf: "stretch", gap: space.xs, paddingHorizontal: space.xs }}>
      <AuthenticatedImage
        path={path}
        accessibilityLabel={message.alt ?? (caption || "Image")}
        // Capped: on an iPad the pane is 700pt wide and a screenshot that
        // stretched to fill it was a poster, not evidence. 560 keeps a phone
        // screenshot readable and stops a landscape one from owning the pane.
        maxWidth={Math.min(DISPLAY_MAX_WIDTH, screen.width - space.lg * 2 - space.xs * 2)}
        maxHeight={420}
        // The artifact tells us its own dimensions, so the tile is the right
        // shape before the bytes arrive.
        ratio={artifactRatio(message)}
        radius={radius.xl}
        placeholderColor={colors.codeBg}
        fallback={<AttachmentEntry message={message} />}
        // CONTAIN, never cover. This is evidence an agent chose to show you;
        // cropping it to fill a box can cut away the very thing it was posted
        // to prove, and a screenshot cropped by the client is a lie about what
        // was on screen.
        style={{ resizeMode: "contain" }}
      />
      {caption ? (
        <Text style={{ ...type.caption, color: colors.textMuted, lineHeight: 17 }}>{caption}</Text>
      ) : null}
    </View>
  );
}

/**
 * An image or file in the transcript, as a tappable row.
 *
 * It does NOT try to inline the bitmap: every artifact URL on a Computer is
 * behind the grant the transport holds, and `<Image>` has no way to ask for it.
 * Naming the file and saying what it is beats a broken-image box, and beats the
 * empty View this used to render.
 */
/**
 * A displayed file, as a row that opens the file's own page (app/artifact/
 * file.tsx): name, size, download, and a text preview when one is worth
 * having. The caption sits under the name in the same row, no divider. The
 * row itself never fetches the bytes.
 */
function FileEntry({ message }: { message: Entry }) {
  const router = useRouter();
  const path = message.url ?? (message.artifactId ? `/api/artifacts/${message.artifactId}` : null);
  if (!path) return <AttachmentEntry message={message} />;
  const name = message.name ?? "File";
  const caption = (message.caption ?? message.text ?? message.alt ?? "").trim();
  return (
    <AttachmentEntry
      message={message}
      detail={caption && caption !== name ? caption : null}
      onPress={() =>
        router.push({
          pathname: "/artifact/file",
          params: {
            url: path,
            name,
            mime: message.mimeType ?? "",
            size: typeof message.size === "number" ? String(message.size) : "",
            caption,
          },
        })
      }
    />
  );
}

export function AttachmentEntry({
  message,
  detail,
  onPress,
}: {
  message: Entry;
  /** Second line under the name. Defaults to the size and a hint. */
  detail?: string | null;
  onPress?: () => void;
}) {
  const { colors, type, space, radius } = useTheme();
  const isImage = message.kind === "image" || !!message.mimeType?.startsWith("image/");
  const label =
    message.name ?? message.caption ?? message.alt ?? message.text ?? (isImage ? "Image" : "File");
  const size =
    typeof message.size === "number" && message.size > 0
      ? formatFileSize(message.size)
      : null;
  const second =
    detail !== undefined
      ? detail
      : size
        ? `${size} · view on the web`
        : "View on the web";

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `Open ${label}` : undefined}
      style={({ pressed }) => ({
        alignSelf: message.role === "user" ? "flex-end" : "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        maxWidth: "90%",
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        // borderStrong, not border: this chip is a card sitting directly on
        // the transcript's near-black background, same as SessionCard on the
        // home screen — the .35-alpha `border` "reads as a rumour against
        // black" there (see that component's own note), and the rumour is
        // just as true here.
        borderColor: colors.borderStrong,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon
        ios={isImage ? "photo" : "doc"}
        android={isImage ? "image" : "description"}
        size={18}
        color={colors.textSecondary}
      />
      <View style={{ minWidth: 0, flex: 1 }}>
        <Text numberOfLines={1} style={{ ...type.footnote, color: colors.text }}>
          {label}
        </Text>
        {second ? (
          <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
            {second}
          </Text>
        ) : null}
      </View>
      {onPress && size ? (
        <Text style={{ ...type.caption, color: colors.textMuted }}>{size}</Text>
      ) : null}
    </Pressable>
  );
}

/**
 * A kind this build has no renderer for, and no text to fall back on — `video`
 * and `html` are already on the wire and more will follow. It names what
 * arrived. The alternative, which this app shipped once for attachments, is a
 * turn that occupies space and says nothing.
 */
function FallbackEntry({ message }: { message: Entry }) {
  const { colors, type, space, radius } = useTheme();
  const label = message.title ?? message.name ?? message.caption ?? message.alt ?? null;
  const kind = message.kind ?? "message";

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
        // Same reasoning as AttachmentEntry just above: a card on black earns
        // the stronger border, not the .35-alpha one.
        borderColor: colors.borderStrong,
      }}
    >
      <Icon ios="questionmark.circle" android="help" size={14} color={colors.textMuted} />
      <Text numberOfLines={2} style={{ ...type.caption, color: colors.textMuted, flexShrink: 1 }}>
        {label ?? `A ${kind} this app can't show yet · view on the web`}
      </Text>
    </View>
  );
}

/**
 * omg.dev's launch contract travels inside the first user turn — several
 * agent CLIs have no separate system-prompt channel for it — so without this,
 * opening a session's first message meant reading past the whole runtime
 * contract to find the one line the user actually typed. Web solves it with
 * an inline disclosure; the phone already has an idiom for "auxiliary text
 * that isn't the conversation" (`ToolRun`'s pill -> sheet), so this reuses
 * that instead of an inline expand fighting the list's layout animation.
 */
function OmgInstructionsChip({ instructions, version }: { instructions: string; version: string | null }) {
  const { colors, type, space, radius } = useTheme();
  const [open, setOpen] = useState(false);
  const symbol: Symbols = { ios: "scroll", android: "description" };

  return (
    <>
      <Pressable
        onPress={() => {
          void Haptics.selectionAsync();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`omg.dev instructions${version ? `, version ${version}` : ""}. Open`}
        style={({ pressed }) => ({
          alignSelf: "flex-end",
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          minHeight: 26,
          paddingHorizontal: space.sm,
          paddingVertical: 3,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: pressed ? colors.cardPressed : colors.card,
        })}
      >
        <Icon ios={symbol.ios} android={symbol.android} size={12} color={colors.textMuted} />
        <Text style={{ ...type.caption, fontWeight: "500", color: colors.text }}>
          omg.dev instructions
        </Text>
        {version ? (
          <Text style={{ ...type.caption, fontFamily: MONO, color: colors.textMuted }}>
            {version}
          </Text>
        ) : null}
        <Icon ios="chevron.right" android="chevron_right" size={10} color={colors.textMuted} />
      </Pressable>

      <ToolSheet visible={open} title="omg.dev instructions" symbol={symbol} onClose={() => setOpen(false)}>
        <Text selectable style={{ fontFamily: MONO, fontSize: 13, lineHeight: 19, color: colors.text }}>
          {instructions}
        </Text>
      </ToolSheet>
    </>
  );
}

export function UserMessage({ message }: { message: Entry }) {
  const { colors, type, space, isDark } = useTheme();
  const body = useBodyText();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const envelope = useMemo(() => parseOmgPromptEnvelope(message.text ?? ""), [message.text]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  // When this turn carries the omg.dev launch envelope, everything below —
  // copy, attachment-splitting, the bubble itself — works from the user's
  // actual task text, not the full contract. The raw `message.text` still
  // goes to the agent; this is presentation only (see omg-prompt-envelope.ts).
  const rawText = envelope?.task ?? message.text ?? "";

  /**
   * COPY IS A LONG PRESS, not a button. The little doc-on-doc glyph under
   * every sent message was chrome on a thing you rarely act on; holding
   * the bubble is what a phone user already does to copy a message. The
   * hold opens a native popup menu on the bubble (UIMenu, the same
   * component the app's other menus use), not an action sheet.
   */
  const copy = () => {
    if (!rawText) return;
    void Haptics.selectionAsync();
    // expo-clipboard, not RN's core Clipboard — the core one is deprecated
    // and slated for removal.
    void Clipboard.setStringAsync(rawText);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };
  const bubbleActions: MenuAction[] = [{ id: "copy", title: "Copy", image: "doc.on.doc" }];

  const [expanded, setExpanded] = useState(false);

  const unsettled = !!(message.pending || message.queued);
  const settleOpacity = useSharedValue(unsettled ? 0.55 : 1);
  useEffect(() => {
    settleOpacity.value = withTiming(unsettled ? 0.55 : 1, {
      duration: 260,
      easing: Easing.out(Easing.quad),
    });
  }, [unsettled, settleOpacity]);
  const settle = useAnimatedStyle(() => ({ opacity: settleOpacity.value }));

  // Attachments ride along in the user's text as absolute upload paths, because
  // that is how the agent receives them. Split them back out so the transcript
  // shows the pictures instead of `/tmp/lfg-uploads/…-IMG_0850.png` on its own
  // line. COPY STILL TAKES THE RAW TEXT: what the agent saw is what gets
  // copied, exactly as on the web.
  const { body: text, attachments } = useMemo(
    () => parseMessageAttachments(rawText),
    [rawText],
  );
  const isLong = text.length > LONG_MESSAGE_CHARS;

  return (
    <View style={{ alignSelf: "stretch", gap: space.xs }}>
      {envelope ? (
        <OmgInstructionsChip instructions={envelope.instructions} version={envelope.version} />
      ) : null}
      {attachments.length ? (
        <UserAttachments attachments={attachments} pending={message.pending} />
      ) : null}
      {/* A caption is optional: attach an image with nothing typed and the
          picture is the whole message, with no empty bubble under it. */}
      {text ? (
        <Reanimated.View
          /**
           * SETTLING, NOT SWAPPING. The bubble is drawn dim while the request
           * is in the air (or queued behind a turn) and fades up to full when
           * the machine has it. Animating opacity on the same row is what
           * replaced the old "Sending…" caption: a caption appearing and then
           * vanishing changed the row's height, and the height change plus
           * the key swap read as the message being re-inserted.
           */
          style={settle}
        >
        <MenuView
          actions={bubbleActions}
          shouldOpenOnLongPress
          colorScheme={isDark ? "dark" : "light"}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "copy") copy();
          }}
          style={{ alignSelf: "flex-end", maxWidth: "85%" }}
        >
        <View
          accessibilityRole="text"
          accessibilityHint="Press and hold to copy"
          /**
           * SIZED TO ITS TEXT, and on the RIGHT. A sent message stretched to
           * the full column looked like another section of the page rather
           * than something a person said, and with the reply directly under it
           * in the same width there was nothing but a border to tell the two
           * apart. Capped at 85% so a long paragraph still wraps well short of
           * the edge instead of becoming a full-width block again.
           */
          style={{
            backgroundColor: colors.card,
            borderRadius: 22,
            borderWidth: StyleSheet.hairlineWidth,
            // borderStrong. The comment above says it plainly: this border is
            // the ONLY thing telling a sent message apart from the reply
            // under it. `border` at .35 alpha is SessionCard's old "rumour
            // against black" mistake, and here it is load-bearing rather than
            // decorative — the one card in the whole app that most needs the
            // edge you can actually see.
            borderColor: colors.borderStrong,
            paddingHorizontal: space.md,
            // 5, not 8: the body style's line height already carries ~3pt of
            // leading above and below the glyphs, so 8 read as 11 and the
            // bubble looked padded out of proportion to its one line.
            paddingVertical: 5,
          }}
        >
          <Text
            // Not `selectable`: the native selection gesture is a long press
            // too, and it would take this one before the copy menu could.
            // The SAME body style the assistant's markdown uses. On the web
            // both roles resolve to `.msg-text.markdown`, so a sent message and
            // a reply read at one size and one rhythm; the bubble is the only
            // difference between them. This used to be lineHeight 22 against
            // the assistant's 23, which made the user's own words look
            // fractionally tighter than the answer to them.
            style={body}
            /**
             * A LONG MESSAGE FOLDS.
             *
             * People paste things here — a stack trace, a spec, a whole file —
             * and an eight-hundred-word bubble pushes the agent's reply, which
             * is the thing you came back to read, entirely off the screen. Ten
             * lines is enough to recognise what you sent; the rest is one tap
             * away and stays expanded once opened.
             *
             * Only when it is actually long: a message that fits gets no
             * control, because a "more" under three lines is furniture.
             */
            numberOfLines={expanded || !isLong ? undefined : COLLAPSED_LINES}
          >
            {text}
          </Text>
          {isLong ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? "Show less of this message" : "Show the whole message"}
              hitSlop={8}
              onPress={() => setExpanded((open) => !open)}
              style={{ marginTop: space.xs }}
            >
              <Text style={{ ...type.footnote, fontWeight: "500", color: colors.textSecondary }}>
                {expanded ? "Show less" : "Show more"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        </MenuView>
        </Reanimated.View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-end",
          gap: space.sm,
          marginTop: 2,
          marginRight: space.sm,
        }}
      >
        {copied ? (
          <Text style={{ ...type.caption, color: colors.textMuted }}>Copied</Text>
        ) : null}
        {/* No "Sending…" caption: the bubble's own dimness says it, and a
            caption that appears and vanishes moved the row. Queued stays,
            because it can sit for minutes and deserves a word. */}
        {message.queued ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon ios="clock" android="schedule" size={11} color={colors.textMuted} />
            <Text style={{ ...type.caption, color: colors.textMuted }}>Queued</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The files a user attached, above the text rather than inside it.
 *
 * Deliberately not in the bubble: an image is not a run of text with a
 * background, and boxing it in bubble chrome makes the caption and the picture
 * read as one cramped card. Sent media gets its own frame and the words get
 * theirs, which is both what the web does and what every messaging client does.
 */
function UserAttachments({
  attachments,
  pending,
}: {
  attachments: MessageAttachment[];
  pending?: boolean;
}) {
  const { colors, space, radius } = useTheme();
  const single = attachments.length === 1;

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: space.xs,
        /**
         * ON THE RIGHT, with the bubble they belong to.
         *
         * The caption under a sent picture is right-aligned because that is
         * what "you said this" looks like in every messaging app — and the
         * picture above it was starting from the left edge, so one message
         * hung off both sides of the screen. They are one utterance and they
         * share an edge.
         */
        justifyContent: "flex-end",
        // Not `stretch`, which is the flex default: that pulls every tile on a
        // row up to the tallest one's height, so a wide screenshot beside a
        // tall one renders squashed. The web stylesheet carries this same note.
        alignItems: "flex-start",
        // Mid-send the picture is already local, so it stays visible and only
        // dims — the bubble's own pending treatment.
        opacity: pending ? 0.7 : 1,
      }}
    >
      {attachments.map((attachment) =>
        attachment.url ? (
          <AuthenticatedImage
            key={attachment.path}
            path={attachment.url}
            accessibilityLabel={attachment.name}
            // One attachment gets room to be recognisable — the common case is
            // a screenshot the user wants to point at. Several tile instead of
            // each claiming the full width.
            maxWidth={single ? ATTACHMENT_MAX : ATTACHMENT_TILE}
            maxHeight={single ? ATTACHMENT_MAX : ATTACHMENT_TILE}
            radius={radius.xl}
            placeholderColor={colors.codeBg}
            fallback={<AttachmentChip name={attachment.name} />}
          />
        ) : (
          <AttachmentChip key={attachment.path} name={attachment.name} />
        ),
      )}
    </View>
  );
}

/**
 * A named chip: the representation for an attachment with nothing to show
 * inline — a PDF, or an image whose bytes are gone (uploads live in tmpdir,
 * which a reboot clears). Still better than the raw path it replaces.
 */
function AttachmentChip({ name }: { name: string }) {
  const { colors, type, space, radius } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        maxWidth: "100%",
        paddingHorizontal: space.md,
        paddingVertical: 6,
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        // Same card-on-black reasoning as AttachmentEntry/UserMessage.
        borderColor: colors.borderStrong,
        backgroundColor: colors.card,
      }}
    >
      <Icon ios="paperclip" android="attach_file" size={13} color={colors.textSecondary} />
      <Text numberOfLines={1} style={{ ...type.footnote, color: colors.text, flexShrink: 1 }}>
        {name}
      </Text>
    </View>
  );
}
