/**
 * Bots — persistent agents you talk to, not tasks you launch.
 *
 * Mirrors `Bot` in `src/bots/store.ts` on the machine, plus the two fields
 * `GET /api/bots` computes server-side from the transcript index
 * (`lastMessagePreview`/`lastMessageTs` — see the route handler's own
 * comment: "the roster line comes from the index, not from a live session,"
 * because a bot is idle between turns by definition and its harness may not
 * be running at all). Reading straight off the bot record's own
 * `lastMessageAt` for the roster's timestamp is deliberate for the same
 * reason: it does not need a live session to be true.
 *
 * `shape`/`colorway` are kept as data even though `BotAvatar` (bot-avatar.tsx)
 * does not yet render five distinct silhouettes — see that file's own doc
 * comment for why, and for what would unlock it. Round-tripping the fields
 * here means nothing is lost server-side while the native avatar stays a
 * fixed shape; a future avatar upgrade only has to change rendering, not
 * plumb the data through again.
 *
 * Degrades to an empty roster on any error, the same way resumable.ts and
 * auto-agents.ts degrade — an older machine with no `/api/bots` yet should
 * not surface a red error banner on a screen someone opened to see who they
 * can talk to.
 */

import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useOmg } from "./provider";

/** Mirrors BOT_SHAPES in src/bots/store.ts. Not yet distinguished on native — see bot-avatar.tsx. */
export const BOT_SHAPES = ["circle", "squircle", "teardrop", "pebble", "hexagon"] as const;
export type BotShape = (typeof BOT_SHAPES)[number];

/** Mirrors BOT_COLORWAYS in src/bots/store.ts. */
export const BOT_COLORWAYS = ["warm", "brand", "violet", "forest", "midnight"] as const;
export type BotColorway = (typeof BOT_COLORWAYS)[number];

/** Mirrors `Bot` in src/bots/store.ts, plus the roster-only preview fields. */
export type Bot = {
  id: string;
  name: string;
  shape?: BotShape;
  colorway?: BotColorway;
  persona: string;
  description?: string;
  capabilities?: string[];
  agent: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
  owner?: string;
  enabled: boolean;
  sessionId?: string;
  createdAt: number;
  lastMessageAt?: number;
  runtimeRefreshPending?: boolean;
  /** Server-computed, GET /api/bots only. Absent when the bot has never been messaged. */
  lastMessagePreview?: string;
  lastMessageTs?: number | null;
};

/**
 * Bare-minimum text for a roster row's preview line.
 *
 * The web strips a `[subagent …]` background-task report from the preview
 * (`isSubagentUpdateText`/`plainPreviewText` in web/src/lib/bot-transcript.ts)
 * because that text is not something a bot "said" in a way worth previewing.
 * Phase 1 native keeps this simple — collapse whitespace, cap length — and
 * leaves the subagent-report filter for a follow-up once bot chat itself
 * exists here to make that distinction meaningful.
 */
export function botPreviewText(bot: Pick<Bot, "lastMessagePreview">): string {
  const raw = bot.lastMessagePreview?.trim();
  if (!raw) return "Say hi to get started.";
  return raw.replace(/\s+/g, " ").slice(0, 140);
}

export function useBots(): {
  bots: Bot[];
  loading: boolean;
  refresh: () => void;
} {
  const { client, bindingId } = useOmg();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // A machine switch invalidates the roster outright — same reasoning as
  // useResumable: these are that box's bots, and showing the previous
  // machine's rows would offer to talk to something this machine never
  // heard of.
  useEffect(() => {
    setBots([]);
  }, [bindingId]);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const payload = await client.transport.request<{ bots?: Bot[] }>("/api/bots");
      setBots(payload.bots ?? []);
    } catch {
      // Older machine with no /api/bots, or a transient failure. No section,
      // rather than an error on a screen someone opened to see their roster.
      setBots([]);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    void load();
  }, [load, tick]);

  return { bots, loading, refresh };
}
