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
import * as Haptics from "expo-haptics";
import type { AndroidSymbol, SFSymbol } from "expo-symbols";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Reanimated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { OmgMessage } from "@omg-dev/protocol";

import { Icon } from "../components";
import { relativeTime } from "./format";
import { CodeBlock, Markdown, useBodyText } from "./markdown";
import {
  parseMessageAttachments,
  type MessageAttachment,
} from "./message-attachments";
import { AuthenticatedImage } from "./remote-image";
import { Text } from "./text";
import { useTheme } from "./theme";

/** A transcript message, plus the flag the live stream sets on its synthetic tail. */
export type Entry = OmgMessage & { streaming?: boolean };

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
  | { type: "tools"; key: string; pairs: ToolPair[] };

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
const ATTACHMENT_MAX = 240;
const ATTACHMENT_TILE = 150;

export function buildTranscriptItems(messages: Entry[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!isCall(message) && !isResult(message)) {
      items.push({
        type: "message",
        key: entryKey(message, index),
        message,
        nextTs: messages[index + 1]?.ts ?? null,
      });
      index += 1;
      continue;
    }
    let end = index;
    while (end < messages.length && (isCall(messages[end]) || isResult(messages[end]))) end += 1;
    const run = messages.slice(index, end);
    items.push({
      type: "tools",
      key: `tools-${entryKey(message, index)}`,
      pairs: buildToolPairs(run, index),
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
  return message.id ?? `${message.kind ?? message.role ?? "msg"}-${index}`;
}

export function TranscriptRow({ item }: { item: TranscriptItem }) {
  if (item.type === "message")
    return <TranscriptEntry message={item.message} nextTs={item.nextTs} />;
  return <ToolRun pairs={item.pairs} />;
}

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

function ToolRun({ pairs }: { pairs: ToolPair[] }) {
  const { colors, type, space, radius, motion } = useTheme();
  const [open, setOpen] = useState(false);
  const turn = useSharedValue(0);

  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));

  const names = useMemo(
    () =>
      pairs
        .map((pair) => (pair.call ? parseToolCall(pair.call.text)?.name : null))
        .filter((name): name is string => !!name),
    [pairs],
  );
  const unique = useMemo(() => [...new Set(names)], [names]);

  if (pairs.length < 2) {
    return (
      <View style={{ alignSelf: "stretch" }}>
        {pairs.map((pair) => (
          <ToolEntry key={pair.key} call={pair.call} result={pair.result} />
        ))}
      </View>
    );
  }

  // "4 × shell" when a run hammers one tool, which is the common shape and
  // says more than a bare count; "4 tool calls" when it is a mixed batch.
  const label =
    unique.length === 1 ? `${pairs.length} × ${unique[0]}` : `${pairs.length} tool calls`;
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
        accessibilityLabel={`${label}. Open`}
        style={({ pressed }) => ({
          alignSelf: "flex-start",
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
        <Text style={{ ...type.caption, fontWeight: "500", color: colors.text }}>{label}</Text>
        <Icon ios="chevron.right" android="chevron_right" size={10} color={colors.textMuted} />
      </Pressable>

      <ToolSheet
        visible={open}
        title={label}
        symbol={symbol}
        onClose={() => setOpen(false)}
      >
        {pairs.map((pair, index) => (
          <View key={pair.key} style={{ gap: space.sm }}>
            {/* Each step keeps its own name and outcome: a run of five shells
                is five different commands, and a wall of blocks with no
                headings is not a transcript of anything. */}
            <ToolStepHeader call={pair.call} result={pair.result} index={index} />
            <ToolDetail call={pair.call} result={pair.result} />
          </View>
        ))}
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
const INTERRUPTED = /^\[Request interrupted by user(?: for tool use)?\]$/i;

function isInterruptedTurn(message: Entry): boolean {
  if (message.role !== "user") return false;
  return INTERRUPTED.test((message.text ?? "").trim());
}

export function TranscriptEntry({
  message,
  nextTs,
}: {
  message: Entry;
  nextTs?: number | null;
}) {
  const { colors, type, space } = useTheme();
  const isUser = message.role === "user";

  if (isInterruptedTurn(message)) {
    return (
      <View style={{ alignSelf: "stretch", alignItems: "center", paddingVertical: 2 }}>
        <Text style={{ ...type.caption, fontSize: 11, color: colors.textMuted }}>
          Interrupted
        </Text>
      </View>
    );
  }
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
      style={{
        alignSelf: "flex-start",
        maxWidth: "100%",
        backgroundColor: colors.card,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
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
  const turn = useSharedValue(0);

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

  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 90}deg` }],
  }));

  const toggle = () => {
    if (!body) return;
    void Haptics.selectionAsync();
    turn.value = withTiming(open ? 0 : 1, { duration: motion.quick });
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
        <Reanimated.View style={chevron}>
          <Icon
            ios="chevron.right"
            android="chevron_right"
            size={10}
            color={body ? colors.textMuted : "transparent"}
          />
        </Reanimated.View>
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
        maxWidth={screen.width - space.lg * 2 - space.xs * 2}
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
export function AttachmentEntry({ message }: { message: Entry }) {
  const { colors, type, space, radius } = useTheme();
  const isImage = message.kind === "image" || !!message.mimeType?.startsWith("image/");
  const label = message.name ?? message.caption ?? message.alt ?? (isImage ? "Image" : "File");
  const size =
    typeof message.size === "number" && message.size > 0
      ? `${Math.max(1, Math.round(message.size / 1024))} KB`
      : null;

  return (
    <View
      style={{
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
        borderColor: colors.border,
      }}
    >
      <Icon
        ios={isImage ? "photo" : "doc"}
        android={isImage ? "image" : "description"}
        size={18}
        color={colors.textSecondary}
      />
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ ...type.footnote, color: colors.text }}>
          {label}
        </Text>
        <Text style={{ ...type.caption, color: colors.textMuted }}>
          {size ? `${size} · view on the web` : "View on the web"}
        </Text>
      </View>
    </View>
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
        borderColor: colors.border,
      }}
    >
      <Icon ios="questionmark.circle" android="help" size={14} color={colors.textMuted} />
      <Text numberOfLines={2} style={{ ...type.caption, color: colors.textMuted, flexShrink: 1 }}>
        {label ?? `A ${kind} this app can't show yet · view on the web`}
      </Text>
    </View>
  );
}

export function UserMessage({ message }: { message: Entry }) {
  const { colors, type, space, radius } = useTheme();
  const body = useBodyText();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = () => {
    if (!message.text) return;
    void Haptics.selectionAsync();
    // expo-clipboard, not RN's core Clipboard — the core one is deprecated and
    // slated for removal, and expo-clipboard is already a dependency (the
    // iMessage sign-in flow uses it to copy the code).
    void Clipboard.setStringAsync(message.text);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const stamp = relativeTime(message.ts);

  // Attachments ride along in the user's text as absolute upload paths, because
  // that is how the agent receives them. Split them back out so the transcript
  // shows the pictures instead of `/tmp/lfg-uploads/…-IMG_0850.png` on its own
  // line. COPY STILL TAKES THE RAW TEXT: what the agent saw is what gets
  // copied, exactly as on the web.
  const { body: text, attachments } = useMemo(
    () => parseMessageAttachments(message.text ?? ""),
    [message.text],
  );

  return (
    <View style={{ alignSelf: "stretch", gap: space.xs }}>
      {attachments.length ? (
        <UserAttachments attachments={attachments} pending={message.pending} />
      ) : null}
      {/* A caption is optional: attach an image with nothing typed and the
          picture is the whole message, with no empty bubble under it. */}
      {text ? (
        <View
          /**
           * SIZED TO ITS TEXT, and on the RIGHT. A sent message stretched to
           * the full column looked like another section of the page rather
           * than something a person said, and with the reply directly under it
           * in the same width there was nothing but a border to tell the two
           * apart. Capped at 85% so a long paragraph still wraps well short of
           * the edge instead of becoming a full-width block again.
           */
          style={{
            alignSelf: "flex-end",
            maxWidth: "85%",
            backgroundColor: colors.card,
            borderRadius: radius.xl,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            opacity: message.pending ? 0.6 : 1,
          }}
        >
          <Text
            selectable
            // The SAME body style the assistant's markdown uses. On the web
            // both roles resolve to `.msg-text.markdown`, so a sent message and
            // a reply read at one size and one rhythm; the bubble is the only
            // difference between them. This used to be lineHeight 22 against
            // the assistant's 23, which made the user's own words look
            // fractionally tighter than the answer to them.
            style={body}
          >
            {text}
          </Text>
        </View>
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
        <Pressable
          onPress={copy}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Copy message"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingVertical: 4,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Icon
            ios={copied ? "checkmark" : "doc.on.doc"}
            android={copied ? "check" : "content_copy"}
            size={12}
            color={colors.textMuted}
          />
          {copied ? (
            <Text style={{ ...type.caption, color: colors.textMuted }}>Copied</Text>
          ) : null}
        </Pressable>
        {message.pending ? (
          <Text style={{ ...type.caption, color: colors.textMuted }}>Sending…</Text>
        ) : stamp ? (
          <Text style={{ ...type.caption, color: colors.textMuted }}>{stamp}</Text>
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
        borderColor: colors.border,
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
