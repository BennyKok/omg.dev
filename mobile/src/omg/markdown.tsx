/**
 * Markdown for the transcript.
 *
 * The web renders with streamdown. None of it ports: it is remark/rehype
 * producing DOM. What DOES port is the tokenizer, so this module uses `marked`
 * (pure JS, no native module, ships over the air) for parsing ONLY, and owns
 * every rendered component itself.
 *
 * Owning the render tree is deliberate. Every off-the-shelf RN markdown library
 * — react-native-markdown-display and friends — hands you its own component set
 * AND its own styling model, and you then fight it to match palette.ts. Since
 * scripts/check-theme-drift.ts exists precisely to keep those tokens identical
 * to the web's index.css, a renderer that cannot be driven from those tokens is
 * a renderer that guarantees drift. This one takes its every colour, size and
 * space from useTheme().
 *
 * What this replaces: a ~120-line hand-rolled parser that understood fences,
 * `code`, **bold** and ATX headings, and nothing else. Agents answer in bullets,
 * tables and links constantly, and all three rendered as literal punctuation in
 * a wall of text.
 *
 * Not supported, on purpose:
 * - Syntax highlighting. The web uses @streamdown/code (Shiki). Shiki is pure
 *   JS but its grammars are heavy, and this bundle is already 2.5MB. Needs
 *   measuring before it earns a place.
 * - Math and mermaid. Both are DOM-bound on the web side.
 * Both degrade to readable monospace rather than to something broken.
 */

import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { marked, type Token, type Tokens } from "marked";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Platform, ScrollView, StyleSheet, View } from "react-native";
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { IconButton } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
const AnimatedText = Reanimated.createAnimatedComponent(Text);

/**
 * One inline slot marks the live edge of an answer.
 *
 * The node stays in the last text container after streaming ends. Only its
 * opacity changes. Mounting and removing a glyph can move the final word to a
 * new line, which makes the completed answer jump by one line. A transparent
 * slot costs one narrow monospace advance, but keeps both layouts identical.
 *
 * This is a nested Text, not a sibling View. React Native lays nested text into
 * the parent's attributed string, so the bar shares the final glyph's baseline
 * and can never become a separate flex row. Reanimated changes opacity on the
 * UI thread; token deltas do not restart the pulse.
 */
function StreamingCaret({ active }: { active: boolean }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    cancelAnimation(opacity);
    if (!active) {
      opacity.value = 0;
      return;
    }
    if (reducedMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.25, { duration: 650, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(opacity);
  }, [active, opacity, reducedMotion]);

  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <AnimatedText
      aria-hidden
      style={[
        {
          // The colour flips with the React commit. The pulse is on the UI
          // thread, but it must not leave one stale visible frame on completion.
          color: active ? colors.primary : "transparent",
          fontFamily: MONO,
          fontSize: 12,
          lineHeight: 16,
        },
        pulse,
      ]}
    >
      ▍
    </AnimatedText>
  );
}

/**
 * `breaks: false` matches the web. streamdown runs remark-gfm without the
 * linebreak extension, so a single newline is a soft wrap on both surfaces; a
 * chat app that turned every newline into a hard break would reflow agent
 * output differently from the dashboard showing the same session.
 */
marked.setOptions({ gfm: true, breaks: false });

/**
 * Body copy, in ONE place.
 *
 * 16px at 1.5 leading, which is what `.msg-text.markdown` resolves to on the
 * web (16px, line-height 1.5 = 24). The two surfaces show the same agent
 * output, so a paragraph has to break at the same rhythm on both. This used to
 * be written out at three separate call sites at lineHeight 23 — both a
 * millimetre off the web and three chances to drift apart.
 *
 * A hook rather than a constant because the colour comes from the theme, which
 * follows the device's appearance.
 */
/**
 * TRANSCRIPT BODY TEXT — 17/26, not 16/24.
 *
 * 16 is iOS's callout size, which is what a caption or a secondary label
 * wears. This is the reading surface of the whole app: long agent replies,
 * read at arm's length, often one-handed on the move. 17 is the system's BODY
 * size and the size Messages and Mail set their content in, and the leading
 * goes with it — 26 keeps the same airy ratio rather than tightening the lines
 * as the glyphs grow.
 */
export function useBodyText() {
  const { colors, type } = useTheme();
  return { ...type.callout, fontSize: 17, lineHeight: 26, color: colors.text };
}

/** Parsing can throw on pathological input; a transcript must never blank out. */
function lex(src: string): Token[] {
  try {
    return marked.lexer(src) as Token[];
  } catch {
    return [{ type: "paragraph", raw: src, text: src, tokens: [] } as unknown as Token];
  }
}

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const { space } = useTheme();
  const tokens = useMemo(() => lex(text), [text]);

  return (
    <View style={{ gap: space.md }}>
      <Blocks tokens={tokens} caret streaming={!!streaming} />
    </View>
  );
}

function Blocks({
  tokens,
  caret,
  streaming,
}: {
  tokens: Token[];
  caret: boolean;
  streaming: boolean;
}) {
  // The caret belongs to the last content block. Each renderer puts the same
  // inline slot after its own final glyph.
  const lastTextish = (() => {
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const t = tokens[i].type;
      if (t !== "space" && t !== "hr") return i;
    }
    return -1;
  })();

  return (
    <>
      {tokens.map((token, i) => (
        <Block
          key={i}
          token={token}
          caret={caret && i === lastTextish}
          streaming={streaming}
        />
      ))}
    </>
  );
}

function Block({
  token,
  caret,
  streaming,
}: {
  token: Token;
  caret: boolean;
  streaming: boolean;
}) {
  const { colors, type, space, radius } = useTheme();
  const body = useBodyText();

  switch (token.type) {
    case "space":
      return null;

    case "heading": {
      const t = token as Tokens.Heading;
      return (
        <Text
          selectable
          style={{
            ...type.headline,
            // h1/h2 earn real presence; deeper levels settle to body size and
            // lean on weight alone rather than inventing a second type scale.
            fontSize: t.depth <= 2 ? 19 : 16,
            lineHeight: t.depth <= 2 ? 25 : 22,
            color: colors.text,
          }}
        >
          <Inline tokens={t.tokens} />
          {caret ? <StreamingCaret active={streaming} /> : null}
        </Text>
      );
    }

    case "paragraph": {
      const t = token as Tokens.Paragraph;
      return (
        <Text selectable style={body}>
          <Inline tokens={t.tokens} />
          {caret ? <StreamingCaret active={streaming} /> : null}
        </Text>
      );
    }

    case "text": {
      const t = token as Tokens.Text;
      return (
        <Text selectable style={body}>
          {t.tokens ? <Inline tokens={t.tokens} /> : t.text}
          {caret ? <StreamingCaret active={streaming} /> : null}
        </Text>
      );
    }

    case "code": {
      const t = token as Tokens.Code;
      return (
        <CodeBlock
          text={t.text}
          lang={t.lang || undefined}
          caret={caret ? <StreamingCaret active={streaming} /> : null}
        />
      );
    }

    case "list": {
      const t = token as Tokens.List;
      return <MdList list={t} caret={caret} streaming={streaming} />;
    }

    case "blockquote": {
      const t = token as Tokens.Blockquote;
      return (
        <View style={{ flexDirection: "row", gap: space.md }}>
          <View style={{ width: 3, borderRadius: 2, backgroundColor: colors.border }} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Blocks tokens={t.tokens ?? []} caret={caret} streaming={streaming} />
          </View>
        </View>
      );
    }

    case "table":
      return <MdTable table={token as Tokens.Table} caret={caret} streaming={streaming} />;

    case "hr":
      return (
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            backgroundColor: colors.border,
            marginVertical: space.xs,
          }}
        />
      );

    case "html": {
      // Raw HTML has no native equivalent. Showing the tags is noise; showing
      // nothing loses content. Strip to the text and let it read as prose.
      const stripped = (token as Tokens.HTML).text.replace(/<[^>]*>/g, "").trim();
      if (!stripped) return null;
      return (
        <Text selectable style={body}>
          {stripped}
          {caret ? <StreamingCaret active={streaming} /> : null}
        </Text>
      );
    }

    default: {
      const raw = (token as { text?: string; raw?: string }).text ?? "";
      if (!raw.trim()) return null;
      return (
        <Text selectable style={body}>
          {raw}
          {caret ? <StreamingCaret active={streaming} /> : null}
        </Text>
      );
    }
  }
}

/** Ordered and unordered, nested to any depth. */
function MdList({
  list,
  caret,
  streaming,
}: {
  list: Tokens.List;
  caret: boolean;
  streaming: boolean;
}) {
  const { colors, space } = useTheme();
  const body = useBodyText();
  const start = typeof list.start === "number" && list.start ? list.start : 1;

  return (
    <View style={{ gap: 6 }}>
      {list.items.map((item, i) => {
        const marker = list.ordered ? `${start + i}.` : "•";
        const isLast = i === list.items.length - 1;
        return (
          <View key={i} style={{ flexDirection: "row", gap: space.sm }}>
            <Text
              style={{
                ...body,
                color: colors.textMuted,
                minWidth: list.ordered ? 20 : 14,
                textAlign: "right",
              }}
            >
              {marker}
            </Text>
            <View style={{ flex: 1, gap: 6 }}>
              <ListItemBody item={item} caret={caret && isLast} streaming={streaming} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A list item's children are block tokens, so an item can hold a nested list or
 * a fenced block. The common case is a single `text` token, which is rendered
 * inline so the bullet and its text share a baseline instead of stacking.
 */
function ListItemBody({
  item,
  caret,
  streaming,
}: {
  item: Tokens.ListItem;
  caret: boolean;
  streaming: boolean;
}) {
  const body = useBodyText();
  const children = item.tokens ?? [];

  const onlyText =
    children.length === 1 && children[0].type === "text"
      ? (children[0] as Tokens.Text)
      : null;

  if (onlyText) {
    return (
      <Text selectable style={body}>
        {onlyText.tokens ? <Inline tokens={onlyText.tokens} /> : onlyText.text}
        {caret ? <StreamingCaret active={streaming} /> : null}
      </Text>
    );
  }

  return <Blocks tokens={children} caret={caret} streaming={streaming} />;
}

/**
 * GFM tables. Horizontally scrollable, because a phone is narrower than any
 * table an agent will produce and squeezing columns to fit makes them
 * unreadable long before it makes them fit.
 */
function MdTable({
  table,
  caret,
  streaming,
}: {
  table: Tokens.Table;
  caret: boolean;
  streaming: boolean;
}) {
  const { colors, type, space, radius } = useTheme();
  const widths = table.header.map(() => 148);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        borderRadius: radius.md,
      }}
    >
      <View>
        <View style={{ flexDirection: "row", backgroundColor: colors.secondary }}>
          {table.header.map((cell, i) => (
            <View
              key={i}
              style={{
                width: widths[i],
                paddingHorizontal: space.sm,
                paddingVertical: space.sm,
                borderRightWidth: i === table.header.length - 1 ? 0 : StyleSheet.hairlineWidth,
                borderRightColor: colors.border,
              }}
            >
              <Text style={{ ...type.footnote, fontWeight: "600", color: colors.text }}>
                <Inline tokens={cell.tokens} />
              </Text>
            </View>
          ))}
        </View>
        {table.rows.map((row, r) => (
          <View
            key={r}
            style={{
              flexDirection: "row",
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
            }}
          >
            {row.map((cell, c) => (
              <View
                key={c}
                style={{
                  width: widths[c] ?? 148,
                  paddingHorizontal: space.sm,
                  paddingVertical: space.sm,
                  borderRightWidth: c === row.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  borderRightColor: colors.border,
                }}
              >
                <Text style={{ ...type.footnote, color: colors.text }}>
                  <Inline tokens={cell.tokens} />
                  {caret &&
                  r === table.rows.length - 1 &&
                  c === row.length - 1 ? (
                    <StreamingCaret active={streaming} />
                  ) : null}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** Inline spans: bold, italic, strike, code, links, images. */
function Inline({ tokens }: { tokens?: Token[] }) {
  const { colors } = useTheme();
  if (!tokens?.length) return null;

  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case "strong":
            return (
              <Text key={i} style={{ fontWeight: "700" }}>
                <Inline tokens={(token as Tokens.Strong).tokens} />
              </Text>
            );
          case "em":
            return (
              <Text key={i} style={{ fontStyle: "italic" }}>
                <Inline tokens={(token as Tokens.Em).tokens} />
              </Text>
            );
          case "del":
            return (
              <Text key={i} style={{ textDecorationLine: "line-through" }}>
                <Inline tokens={(token as Tokens.Del).tokens} />
              </Text>
            );
          case "codespan":
            return (
              <Text
                key={i}
                style={{ fontFamily: MONO, fontSize: 14, backgroundColor: colors.codeBg }}
              >
                {(token as Tokens.Codespan).text}
              </Text>
            );
          case "link": {
            const t = token as Tokens.Link;
            return (
              <Text
                key={i}
                accessibilityRole="link"
                style={{ color: colors.primary }}
                onPress={() => {
                  void Haptics.selectionAsync();
                  void Linking.openURL(t.href).catch(() => {});
                }}
              >
                {t.tokens?.length ? <Inline tokens={t.tokens} /> : t.text}
              </Text>
            );
          }
          case "image": {
            // Artifact URLs sit behind the transport's grant and <Image> cannot
            // send it, so name the image rather than render a broken box.
            const t = token as Tokens.Image;
            return (
              <Text key={i} style={{ color: colors.textMuted }}>
                {t.text || t.title || "image"}
              </Text>
            );
          }
          case "br":
            return <Text key={i}>{"\n"}</Text>;
          case "escape":
            return <Fragment key={i}>{(token as Tokens.Escape).text}</Fragment>;
          case "html":
            return (
              <Fragment key={i}>
                {(token as Tokens.HTML).text.replace(/<[^>]*>/g, "")}
              </Fragment>
            );
          case "text":
          default: {
            const t = token as Tokens.Text;
            if (t.tokens?.length) return <Inline key={i} tokens={t.tokens} />;
            return <Fragment key={i}>{t.text ?? ""}</Fragment>;
          }
        }
      })}
    </>
  );
}

/** A fenced block with its language and a copy button, same as the web. */
export function CodeBlock({
  text,
  lang,
  caret,
}: {
  text: string;
  lang?: string;
  caret?: ReactNode;
}) {
  const { colors, type, space, radius } = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailingBreaks = caret ? text.match(/\n+$/)?.[0] ?? "" : "";
  const visibleText = trailingBreaks ? text.slice(0, -trailingBreaks.length) : text;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = () => {
    void Haptics.selectionAsync();
    void Clipboard.setStringAsync(text);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={{ backgroundColor: colors.codeBg, borderRadius: radius.md, overflow: "hidden" }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: space.md,
          paddingRight: space.xs,
          paddingTop: space.xs,
        }}
      >
        <Text style={{ ...type.caption, color: colors.textMuted, flex: 1 }}>{lang ?? "code"}</Text>
        <IconButton
          ios={copied ? "checkmark" : "doc.on.doc"}
          android={copied ? "check" : "content_copy"}
          accessibilityLabel="Copy code"
          onPress={copy}
          size={13}
          color={colors.textMuted}
        />
      </View>
      {/* Code does not wrap: an agent's output is full of paths and commands
          that become unreadable when broken mid-token. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm }}>
          <Text
            selectable
            style={{ fontFamily: MONO, fontSize: 13, lineHeight: 19, color: colors.text }}
          >
            {visibleText}
            {caret}
            {trailingBreaks}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
