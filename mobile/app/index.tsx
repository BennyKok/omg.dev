/**
 * The session list — the app's home, matching the web Computer one-to-one:
 * the mark and a machine chip up top, WORKING/IDLE sections as dot + label +
 * count headers sitting on the page background, each session its own rounded
 * card, and a composer pinned to the bottom that actually starts sessions.
 *
 * The important behaviour here is not the list, it is `readiness`. A Computer
 * that is merely cold answers 425 while it resumes, and the whole point of
 * separating that from an error is that this screen must say "waking" rather
 * than "broken". Getting that wrong is the difference between a product that
 * feels asleep and one that feels dead.
 */

import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Text } from "../src/omg/text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OmgSession } from "@omg-dev/protocol";
import type { OmgConnectionStatus } from "@omg-dev/client";

import {
  EmptyState,
  HomeComposer,
  IconButton,
  PrimaryButton,
  SectionHeader,
  SessionCard,
  StatusDot,
  withAlpha,
} from "../src/components";
import { useAttachments } from "../src/omg/attachments";
import {
  buildSessionTree,
  flattenNodes,
  nodeBusy,
  sessionStableId,
  type SessionNode,
} from "../src/omg/session-tree";
import { AutoFindingCard } from "../src/omg/auto-agent-card";
import { useOverlapWatch } from "../src/omg/list-overlap-watch";
import { groupNodesByProject } from "../src/omg/session-groups";
import { sessionPreview } from "../src/omg/session-preview";
import { selectHomeAutoFindings, useAutoAgents, type AutoFindingRow } from "../src/omg/auto-agents";
import { useComputerPicker } from "../src/omg/computer-picker";
import { useDictation } from "../src/omg/dictation";
import { PressableScale } from "../src/omg/motion";
import { useResumable } from "../src/omg/resumable";
import { useUsage } from "../src/omg/usage";
import { LucideIcon } from "../src/omg/lucide";
import { DropdownMenu } from "../src/omg/menu";
import { ALL_PROJECTS, useAgentPicker, useProjectPicker } from "../src/omg/session-options";
import { useOmg } from "../src/omg/provider";
import { useToast } from "../src/omg/toast";
import { SessionListSkeleton } from "../src/omg/skeleton";
import { useTheme } from "../src/omg/theme";
import { bindingLabel, relativeTime } from "../src/omg/format";
import { CLOUD_BINDING_ID } from "../src/omg/config";
import {
  isSharedBindingId,
  SHARED_REVOKED_DETAIL,
  sharedBindingLabel,
} from "../src/omg/computer-shared-binding";

/**
 * A session and everything it spawned.
 *
 * Children are indented under their parent with a spine and an elbow, the way
 * the web draws the same family. The elbow lands on the CARD's midline rather
 * than the midline of the card plus its own descendants, which is the detail
 * that makes a three-deep tree still read as a tree.
 *
 * A subagent is not archivable from here: it belongs to its parent's run, and
 * swiping one away would leave the parent waiting on something the list says
 * is gone.
 */
function SessionFamily({
  node,
  depth = 0,
  onOpen,
  onArchive,
  animateEntry = true,
}: {
  node: SessionNode;
  depth?: number;
  onOpen: (id: string | null) => void;
  onArchive?: (id: string | null) => void;
  /** See the identical prop on SessionCard/AutoFindingCard for why. */
  animateEntry?: boolean;
}) {
  const { colors, space } = useTheme();
  const session = node.session;

  return (
    <View style={{ alignSelf: "stretch" }}>
      <SessionCard
        title={session.title || session.lastUserText || "Untitled session"}
        subtitle={sessionPreview(session)}
        timestamp={relativeTime(session.lastActivityAt ?? session.startedAt)}
        agent={session.agent ?? session.agentLabel}
        busy={!!session.busy}
        blocked={session.status === "blocked"}
        onPress={() => onOpen(session.sessionId)}
        onArchive={depth === 0 && onArchive ? () => onArchive(session.sessionId) : undefined}
        animateEntry={animateEntry}
      />

      {node.children.length ? (
        <View style={{ marginLeft: space.xl, marginTop: space.sm, gap: space.sm }}>
          {node.children.map((child, index) => (
            <SessionBranch
              key={sessionStableId(child.session)}
              node={child}
              depth={depth + 1}
              last={index === node.children.length - 1}
              onOpen={onOpen}
              animateEntry={animateEntry}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One child, plus the two lines that tie it to its parent.
 *
 * THE HEIGHT IS MEASURED, not assumed. The elbow has to meet the card on its
 * MIDLINE, and a card is 60pt with one line of text and ~72 with two — a
 * constant put the join above centre on some rows and below it on others, which
 * is exactly the sort of thing that makes a tree look hand-drawn.
 *
 * The spine is one continuous run. Drawn per-child at `height: 100%` it stopped
 * at each card's bottom edge and left a gap-sized hole between every sibling —
 * a dashed line down the family. Stretching it `top`-to-`bottom` past the gap
 * closes those; the last child stops it at its own midline so the family ends
 * on the elbow instead of trailing a line into whatever follows.
 */
function SessionBranch({
  node,
  depth,
  last,
  onOpen,
  animateEntry = true,
}: {
  node: SessionNode;
  depth: number;
  last: boolean;
  onOpen: (id: string | null) => void;
  /** See the identical prop on SessionCard/AutoFindingCard for why. */
  animateEntry?: boolean;
}) {
  const { colors, space } = useTheme();
  const [cardHeight, setCardHeight] = useState(0);
  // Until the row has been measured, a sane default keeps the line from
  // flashing at the wrong place on first paint.
  const midline = cardHeight ? cardHeight / 2 : 30;

  return (
    <View onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>
      {/**
       * The last child gets a ROUNDED ELBOW drawn as one bordered box — a left
       * border and a bottom border meeting in a corner radius, which is how
       * the web draws it (`rounded-bl-lg border-b border-l`). Two straight
       * rects meeting at a right angle is a different drawing: it reads as
       * plumbing, and it cannot be softened at the join no matter how thin the
       * lines are.
       *
       * A child with siblings below it is a T-junction instead: the spine has
       * to carry on past the branch, so the corner cannot be part of it.
       *
       * The card inside carries its own 16pt margin, so the branch crosses
       * that too — sized to the indent alone it stopped in mid air, short of
       * the row it points at.
       */}
      {last ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: SPINE_INSET,
            top: -space.sm,
            width: space.lg - SPINE_INSET,
            height: midline + space.sm,
            borderLeftWidth: LINE,
            borderBottomWidth: LINE,
            borderBottomLeftRadius: ELBOW_RADIUS,
            borderColor: colors.borderStrong,
          }}
        />
      ) : (
        <>
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: SPINE_INSET,
              top: -space.sm,
              bottom: -space.sm,
              width: LINE,
              backgroundColor: colors.borderStrong,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: SPINE_INSET,
              top: midline,
              width: space.lg - SPINE_INSET,
              height: LINE,
              backgroundColor: colors.borderStrong,
            }}
          />
        </>
      )}
      <SessionFamily node={node} depth={depth} onOpen={onOpen} animateEntry={animateEntry} />
    </View>
  );
}

/**
 * What to call an ended session.
 *
 * The machine's resumable list falls back to the PROJECT or the worktree
 * folder when a session never earned a title, which on a phone produced a
 * column reading "vibes, vibes, vibes, lfg-7e4d5d" — twenty rows naming the
 * same repo and identifying none of them. The first thing the person actually
 * said is a far better name for a conversation, so a title that is only the
 * folder gets replaced by it.
 */
function recentTitle(session: {
  title?: string | null;
  lastUserText?: string | null;
  project?: string | null;
  cwd?: string | null;
}): string {
  const title = session.title?.trim();
  const said = session.lastUserText?.trim();
  const folder = session.cwd?.split("/").filter(Boolean).pop();
  const isFolderName =
    !!title && (title === session.project?.trim() || title === folder);
  if (title && !isFolderName) return title;
  return said || title || "Session";
}

/** Nothing said, and named after the folder it ran in. See the Recent filter. */
function isAnonymous(session: {
  title?: string | null;
  lastUserText?: string | null;
  project?: string | null;
  cwd?: string | null;
}): boolean {
  if (session.lastUserText?.trim()) return false;
  const title = session.title?.trim();
  if (!title) return true;
  const folder = session.cwd?.split("/").filter(Boolean).pop();
  return title === session.project?.trim() || title === folder;
}

/** Hairlines vanish against black at this length; a point and a half reads. */
const LINE = 1.5;
/**
 * How far the spine sits inside the indent. At 0 it ran up the very edge of
 * the child's box, which put it left of the parent card it descends from and
 * made the family look detached from its own parent.
 */
const SPINE_INSET = 7;
/** Enough curve to read as a corner at 1.5pt, not enough to become an arc. */
const ELBOW_RADIUS = 9;

/**
 * A conservative floor for the composer's height, before it has been
 * measured — see `composerHeight` below. The real composer is at least the
 * 44pt field row plus the agent/model/thinking pill row plus their spacing;
 * this rounds up rather than down so a stale estimate over-clears the list
 * instead of letting a row sit under the glass.
 */
const MIN_COMPOSER_HEIGHT = 96;

/**
 * How far above the composer the scroll content starts dissolving.
 *
 * Borrowed from Claude's iOS app: the transcript doesn't stop at a hard edge
 * above the input bar, it fades into the page background first, so scrolling
 * text never collides with the glass. 120pt is roughly two lines of body text
 * plus breathing room — enough to read as a dissolve, not so much that the
 * last visible row looks half-erased.
 */
const COMPOSER_FADE_HEIGHT = 120;

/**
 * Gradient stops for the composer fade, eased rather than linear.
 *
 * A straight transparent-to-opaque ramp reads as a flat grey smudge sliding
 * over the content — the eye is very sensitive to linear alpha ramps. These
 * stops follow an ease-in curve (roughly t^2, sampled at six points) so the
 * fade starts almost imperceptibly at the top and only does most of its work
 * in the last third, near the composer itself. `hex` is always `colors.bg` —
 * a plain hex token, never an rgba string — so `withAlpha` can parse it.
 */
function composerFadeStops(hex: string): { colors: [string, string, ...string[]]; locations: [number, number, ...number[]] } {
  const steps: Array<[number, number]> = [
    [0, 0],
    [0.15, 0.02],
    [0.35, 0.12],
    [0.55, 0.3],
    [0.75, 0.56],
    [1, 1],
  ];
  return {
    locations: steps.map(([location]) => location) as [number, number, ...number[]],
    colors: steps.map(([, alpha]) => withAlpha(hex, alpha)) as [string, string, ...string[]],
  };
}

/**
 * The greeting the web Live view carries, in the bar slot the removed
 * "Sessions" title left empty.
 *
 * It is the RESTING state: what the header says when nothing is happening.
 * While agents are working it yields to that for a short cameo and comes back
 * — the same dwell the web uses (8s of greeting, 2.8s of activity), because a
 * status line that flips at an even rate reads as a ticker and stops being
 * glanceable.
 *
 * The name comes from the signed-in account or not at all. There is no
 * fallback to a user id or an email stem: "Welcome, itechbenny" is worse than
 * "Welcome".
 */
function LiveWelcome({
  firstName,
  busyCount,
  onPress,
}: {
  firstName: string;
  busyCount: number;
  /** The greeting is the door to the Notification Center, as on the web. */
  onPress?: () => void;
}) {
  const { colors, type } = useTheme();
  const [showActivity, setShowActivity] = useState(false);

  useEffect(() => {
    if (!busyCount) {
      setShowActivity(false);
      return;
    }
    const timer = setTimeout(() => setShowActivity((current) => !current), showActivity ? 2800 : 8000);
    return () => clearTimeout(timer);
  }, [busyCount, showActivity]);

  const welcome = firstName ? `Welcome, ${firstName}` : "Welcome";
  const activity = `${busyCount} agent${busyCount === 1 ? "" : "s"} building`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
      <Text
        numberOfLines={1}
        style={{ ...type.headline, color: colors.text, maxWidth: 210 }}
      >
        {busyCount > 0 && showActivity ? activity : welcome}
      </Text>
    </Pressable>
  );
}

/**
 * The list screen owns the draft and the two choices that go with it; the
 * pickers own which options exist and which one is current. See
 * session-options.ts for why neither selection is persisted.
 */
export default function SessionsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, type, space } = useTheme();
  const { client, readiness, probe, bindingId, bindings, sharedComputers, user } = useOmg();
  const computerPicker = useComputerPicker();
  // No session exists yet, so these upload to the pre-session endpoint and
  // ride along in the prompt that creates one.
  const attachments = useAttachments(null);
  // Already one entry per agent rather than per login: the machine folds them
  // now (`/api/usage/summary`), and useUsage only does it itself when talking
  // to a box too old to have that endpoint.
  const { providers: usage, loading: usageLoading } = useUsage();
  const { sessions: resumable, refresh: refreshResumable } = useResumable();
  const {
    agents: autoAgents,
    findings: autoFindings,
    refresh: refreshAuto,
    setFindingStatus: setAutoFindingStatus,
  } = useAutoAgents();
  const agentPicker = useAgentPicker();
  const projectPicker = useProjectPicker();

  const [sessions, setSessions] = useState<OmgSession[]>([]);
  /**
   * HAS SESSIONS HAD ITS TURN YET — see the long note on `SESSIONS_SETTLE_TIMEOUT_MS`
   * below for what this exists to prevent. Kept as its own flag rather than
   * derived from `loading`/`sessions.length`, because neither means the right
   * thing here: `loading` starts false before the first fetch has even been
   * attempted (indistinguishable from "already resolved"), and an EMPTY
   * `sessions` result is a fully valid, resolved answer, not an unresolved one.
   */
  const [sessionsSettled, setSessionsSettled] = useState(false);
  // A machine switch invalidates this the same way it invalidates `sessions`
  // itself (see the load() effect) — the new machine's Auto/Recent rows must
  // wait their turn behind the new machine's OWN session list, not ride in on
  // however settled the PREVIOUS machine's flag happened to be.
  useEffect(() => {
    setSessionsSettled(false);
  }, [bindingId]);
  const [loading, setLoading] = useState(false);
  /**
   * ONLY A PULL SPINS THE SPINNER.
   *
   * `loading` covers every read — focus, the 10s poll, a machine probe — and
   * wiring RefreshControl to it meant the list flashed "refreshing" on its own
   * every few seconds. A refresh indicator is a reply to a gesture; when
   * nobody asked, the answer is silence.
   */
  const [pulling, setPulling] = useState(false);
  /**
   * Which open finding is expanded to show its full reasoning. ONE at a
   * time: a finding carries several reasoning bullets and a suggestion, so
   * two open at once push the Recent section off the bottom of a phone.
   */
  const [expandedAuto, setExpandedAuto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (error) toast.show(error, { intent: "error" });
  }, [error, toast]);
  /**
   * DIAGNOSTIC, NOT A FIX — see list-overlap-watch.tsx.
   *
   * Benny has seen cards drawn on top of each other on his real device; it
   * has not reproduced on a simulator despite real testing against his own
   * large, actively-churning account. Rather than guess at a mechanism
   * nobody has caught in the act, `OverlapRow` measures every top-level
   * row's actual on-screen frame and flags it the moment two rows'
   * positions genuinely intersect — turning "cannot reproduce" into "will
   * know the instant it happens," with the exact pixel offsets, wherever it
   * happens next.
   *
   * The toast is gated to Benny's own account (or a dev build) — this is a
   * one-report diagnostic, not a feature, and firing a red "internal error"
   * toast for some unrelated user's transient, self-correcting layout race
   * would be a worse experience than the bug it exists to catch. Everyone
   * still gets the console.error, which costs nothing with no debugger
   * attached and is free evidence the moment one is.
   */
  const notifyUserOfOverlap = __DEV__ || user?.email === "itechbenny@gmail.com";
  const { Row: OverlapRow } = useOverlapWatch(toast, notifyUserOfOverlap);
  /**
   * THE FIX, once list-overlap-watch.tsx had a mechanism to point at:
   * suppress BOTH `entering` and `layout` for a fixed window after this
   * screen mounts, then never again.
   *
   * Both caught overlaps were on cold load, and both are consistent with the
   * same race: Working/Idle rows come from `sessions` (client.listSessions())
   * while Auto rows come from a SEPARATE fetch (useAutoAgents(), see above) —
   * two independent sources that do not resolve on the same tick. Cold load
   * is the one moment potentially dozens of rows across BOTH sources mount
   * and start their own `entering: FadeInDown` within the same beat; the
   * measured cross-row position corruption showed up between rows in
   * DIFFERENT sections (idle vs. auto) and rows in the SAME section
   * (recent vs. recent), which is what an entering-animation race predicts
   * and a single stranded-view bug would not.
   *
   * `layout` ALSO SUPPRESSED, not just `entering` — first attempt left
   * `layout: LinearTransition` live and still measured 1 overlap in 5 cold
   * loads. Either source can straggle in across more than one wave (a
   * session's subagent children resolving after its own row, a finding's
   * `occurrences` bumping mid-load), and a `layout` reflow racing a sibling
   * that is itself still settling is the same class of race `entering` is —
   * animating FROM or TO a frame that is about to move again is exactly how
   * a transiently-wrong position gets painted. During the window a row
   * SNAPS directly to its current correct position with no animation,
   * rather than risk animating relative to one.
   *
   * A FIXED WINDOW since mount, not an "is any section still empty" check,
   * deliberately — the two sources resolving at different times is exactly
   * the thing being raced, so gating on either one individually reintroduces
   * the same asymmetry. A wall-clock window since this screen first rendered
   * covers both regardless of which arrives first, second, or late (a
   * source that lands after the window animates in on its own, by which
   * point everything else has already settled — nothing left to race). Wide
   * enough to cover a slow fetch or a multi-wave subagent tree resolving,
   * short enough that it's not what a person notices as "the list is slow."
   *
   * 3500ms IS A GUESS, NOT A MEASUREMENT — tunable, not sacred. It's sized
   * off simulator fetch timing on a fast Mac; a real device on real
   * cellular could easily need longer, or a fast wifi connection could get
   * away with less. list-overlap-watch.tsx is what would tell you which:
   * if it starts firing again on real devices with this window in place,
   * that's a signal to widen it before reaching for a different mechanism
   * entirely, not a sign the whole approach is wrong.
   */
  const mountedAtRef = useRef(Date.now());
  const COLD_LOAD_WINDOW_MS = 3500;
  const animateEntry = Date.now() - mountedAtRef.current >= COLD_LOAD_WINDOW_MS;
  /**
   * Live-socket health. The SDK's statuses are connecting | live | reconnecting
   * | offline — there is no "connected", and comparing against that string made
   * the banner permanently true. Worse, subscribeConnection does NOT open the
   * socket (only subscribeTranscript does), so this screen sat at "connecting"
   * forever and told everyone their computer was reconnecting when nothing was
   * wrong. Only a genuine drop is worth saying out loud.
   */
  const [connection, setConnection] = useState<OmgConnectionStatus>("connecting");
  const [draft, setDraft] = useState("");
  const [starting, setStarting] = useState(false);
  const dictation = useDictation(
    // The whole transport, not a fetch closure: dictation now opens a
    // websocket to stream PCM as you speak, and the grant, its refresh and the
    // selected machine's origin all live on this one object.
    client?.transport ?? null,
    /**
     * A finished take STARTS THE SESSION. Speaking a prompt and starting the
     * work are one intention, and leaving the words in the field waiting for a
     * second tap put a button under the thumb that had just finished
     * dictating. A cancelled take never reaches here — the hook drops it.
     */
    (text, meta) => {
      setDraft((current) => {
        const next = current ? `${current} ${text}` : text;
        if (meta?.final) void startRef.current?.(next);
        return meta?.final ? "" : next;
      });
    },
  );
  // A take that definitively failed (no working STT provider, not just
  // silence) — say so instead of leaving the mic looking like it forgot.
  useEffect(() => {
    if (dictation.error) toast.show(dictation.error, { intent: "error" });
  }, [dictation.error, toast]);
  /** `startSession` is declared below the hook that has to call it. */
  const startRef = useRef<((prompt: string) => void) | null>(null);

  const ready = readiness?.status === "ready";

  /**
   * WHAT THE LIST ACTUALLY DEPENDS ON, not the whole payload.
   *
   * The 10s poll below re-fetches even when nothing a person would notice has
   * changed, and the machine bumps heartbeat-y fields (`lastActivityAt`,
   * `last.ts`) on a live-but-idle session just by having it open. Every field
   * in the response therefore changes on a schedule that has nothing to do
   * with what's on screen, and a naive `setSessions(freshArray)` would hand
   * `roots`/`working`/`idle`/`recent` (all `useMemo`d off `sessions` by
   * reference) a brand-new array every single poll regardless — which
   * re-renders every mounted `SessionFamily`/`SessionCard` and re-arms each
   * one's `layout: LinearTransition` (see motion.tsx) even though not one row
   * actually moved.
   *
   * This is a PERFORMANCE fix and nothing more. It was originally written on
   * the theory that the churn was also what produced the "list renders twice,
   * offset, with a second list's rows peeking through the gaps" report; that
   * theory was wrong, and the note that used to be here claiming it as the
   * best lead has been removed rather than left to mislead the next reader.
   * The real cause was the `exiting` animation on SessionCard stranding
   * unmounted rows out of flow — found and fixed separately, see motion.tsx.
   *
   * Keep this anyway, on its own merits: a quiet poll that changed nothing
   * costs a JSON compare here instead of re-rendering every mounted card and
   * re-arming every layout transition in the list.
   */
  function sessionsSignature(list: OmgSession[]): string {
    return JSON.stringify(
      list.map((s) => [
        s.sessionId,
        s.nativeSessionId,
        s.tmuxName,
        s.title,
        s.lastUserText,
        s.agent,
        s.agentLabel,
        s.busy,
        s.status,
        s.parentSessionId,
        s.parentNativeSessionId,
        s.model,
      ]),
    );
  }
  const sessionsSignatureRef = useRef<string | null>(null);

  /**
   * @param quiet Skip the loading flag. A background refresh must not light up
   * the pull-to-refresh spinner — the list would appear to be reloading every
   * few seconds while nobody asked it to.
   */
  const load = useCallback(
    async (quiet = false) => {
      if (!client || !ready) return;
      if (!quiet) setLoading(true);
      try {
        const fresh = await client.listSessions();
        const signature = sessionsSignature(fresh);
        // Same rows, same order, same everything that renders: keep the
        // existing array identity so nothing downstream re-renders or
        // re-animates for a poll that changed nothing on screen.
        if (signature !== sessionsSignatureRef.current) {
          sessionsSignatureRef.current = signature;
          setSessions(fresh);
        }
        setError(null);
      } catch (e) {
        // A failed background poll keeps the list it already has. Only a
        // refresh someone ASKED for is worth an error banner.
        if (!quiet) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!quiet) setLoading(false);
        // Resolved — success OR failure, both count. An empty or errored
        // result is a fully answered question, not an unanswered one; see
        // `sessionsSettled`'s own doc comment for why this can't be derived
        // from `loading` or `sessions.length` instead. This line is only
        // reached once the `!client || !ready` guard above has already been
        // passed, so a machine that's still waking never marks itself
        // settled by accident — see the timeout below for what covers a
        // machine that never finishes waking at all.
        setSessionsSettled(true);
      }
    },
    [client, ready],
  );

  /**
   * WHY AUTO/RECENT CAN PAINT BEFORE WORKING/IDLE, AND WHY THAT IS THE BUG.
   *
   * `load()` above gates on `ready` — the machine's own wake/probe round
   * trip has to finish before it even ATTEMPTS `client.listSessions()`.
   * `useAutoAgents()` and `useResumable()` (both above) gate their own
   * fetches on nothing but the API client existing — no readiness check —
   * so on a machine that needs waking, Auto and Recent's requests are
   * already in flight, and often already answered, while Sessions hasn't
   * started yet. The result: on the first render where `ready` flips true,
   * Auto/Recent can already have rows to show while Working/Idle are still
   * empty — and then Sessions resolves a beat later and mounts a batch of
   * rows ABOVE Auto, shoving it down mid-settle. list-overlap-watch.tsx
   * caught this live, twice identically: Idle mounting late while Auto had
   * already-settled rows re-measuring, not newly mounting ones.
   *
   * THE FIX: Auto and Recent do not render their rows until Sessions has
   * had its own turn — `sessionsSettled`, set above once `load()` resolves
   * (success OR failure both count; see that flag's doc comment). This
   * removes the ordering bug directly — nothing above a section can shove
   * it late if the section waits for everything above it — rather than
   * papering over its consequences with animation suppression, which
   * #150 already tried and which did not hold up under real-device
   * evidence.
   *
   * THE TIMEOUT IS WHAT MAKES THIS SAFE. `sessionsSettled` becoming true
   * depends on `load()` actually running to completion, and `load()`
   * refuses to run at all while `!ready` — so a machine that never finishes
   * waking, or a `listSessions()` call that hangs, would leave Auto and
   * Recent hidden FOREVER without this. `SESSIONS_SETTLE_TIMEOUT_MS` forces
   * `sessionsSettled` true regardless once it elapses, trading one
   * old-fashioned reflow (Auto/Recent appearing, then Sessions arriving
   * even later and pushing them down the ORIGINAL way) for never blocking
   * indefinitely. 2500ms is a guess, not a measurement, sized as "longer
   * than a `listSessions()` call should ever reasonably take once the
   * machine is confirmed awake" — this hook only starts counting once
   * `ready` is true, so it is not timing the wake itself, only the session
   * fetch that follows it. Tunable the same way COLD_LOAD_WINDOW_MS was —
   * list-overlap-watch.tsx would show it if this needs to move.
   */
  const SESSIONS_SETTLE_TIMEOUT_MS = 2500;
  useEffect(() => {
    if (!ready || sessionsSettled) return;
    const timer = setTimeout(() => setSessionsSettled(true), SESSIONS_SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready, sessionsSettled]);

  /**
   * TITLES AND SUBTITLES GO STALE WHILE YOU WATCH THEM, so this polls.
   *
   * The live socket carries connection state and per-session TRANSCRIPTS —
   * `subscribeConnection` and `subscribeTranscript` are the only channels the
   * SDK exposes. There is nothing that pushes "this session's title changed",
   * and a session's title and last message change constantly while an agent
   * works. Refreshing only on focus meant the list you were staring at was a
   * snapshot from whenever you opened it: a session would sit there named
   * after a prompt it finished ten minutes ago.
   *
   * 10s, and only while the screen is focused, so a backgrounded app is not
   * talking to the machine. Quiet, so it never touches the refresh spinner.
   */
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(true), 10_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  // Surface a dropped socket without stealing the screen — the list is still
  // valid, it is just not updating.
  useEffect(() => {
    if (!client) return;
    return client.live.subscribeConnection((state) => setConnection(state.status));
  }, [client]);

  const currentSharedComputer = useMemo(
    () => sharedComputers.find((c) => c.id === bindingId) ?? null,
    [sharedComputers, bindingId],
  );
  const currentBinding = useMemo(
    () => bindings.find((b) => b.id === bindingId) ?? currentSharedComputer ?? null,
    [bindings, currentSharedComputer, bindingId],
  );

  // `bindingLabel` reads a machine's OWN computerUrl/defaultFolder, neither of
  // which a synthesized shared entry carries (a guest never gets the owner's
  // direct box URL) — calling it there would fall through to a truncated
  // "shared:ab12cd…" id. sharedBindingLabel is the one that actually knows
  // how to name it.
  const machineName = currentSharedComputer
    ? sharedBindingLabel(currentSharedComputer, sharedComputers)
    : currentBinding
      ? bindingLabel(currentBinding)
      : bindingId === CLOUD_BINDING_ID
        ? "Cloud computer"
        : "No computer";

  /** First name only, capitalised — the web greets the same way. */
  const firstName = useMemo(() => {
    const raw = user?.name?.trim();
    if (!raw) return "";
    const first = raw.split(/\s+/)[0] ?? "";
    return first ? `${first.charAt(0).toUpperCase()}${first.slice(1)}` : "";
  }, [user?.name]);

  /**
   * Families, not rows. A session that spawned subagents owns them, and the
   * family travels together — see session-tree.ts for why the parent's own
   * flag is not enough to describe it.
   */
  const roots = useMemo(
    () => buildSessionTree(sessions.filter((session) => projectPicker.matches(session))),
    [sessions, projectPicker],
  );

  /**
   * GROUPED BY FOLDER, NOT BY WORKING/IDLE.
   *
   * The phone was the last surface still splitting the fleet by status while
   * the rail split it by folder, so the same sessions read as two different
   * shapes depending on the window. See src/omg/session-groups.ts, which is
   * the rule both surfaces now share.
   *
   * A status split also moved a row between two groups every time an agent
   * started or stopped, reordering the list to say something the row's own
   * mark already says.
   */
  const projectGroups = useMemo(
    () => groupNodesByProject(roots, (node) => flattenNodes([node]).length),
    [roots],
  );

  /**
   * Still needed, but only to COUNT — the ambient header says how many agents
   * are building, and archive is refused on a running session. Neither one
   * sections the list any more.
   */
  const working = useMemo(() => roots.filter(nodeBusy), [roots]);

  /**
   * Ended sessions, minus anything the live list is already showing.
   *
   * The machine excludes live ids server-side, but the two lists are fetched
   * separately and a session that closes (or resumes) between the two reads
   * would otherwise appear twice — the same row under two headings, which
   * reads as a bug in the list rather than a race.
   */
  const recent = useMemo(() => {
    const live = new Set(
      sessions.flatMap((s) => [s.sessionId, (s as { nativeSessionId?: string }).nativeSessionId])
        .filter((v): v is string => !!v),
    );
    return resumable.filter(
      (session) =>
        !live.has(session.sessionId) &&
        // A session with no title of its own AND nothing anyone said is not a
        // conversation you can return to — it is an agent process that
        // existed. The machine lists them because they are technically
        // resumable; on a phone they arrived as eight consecutive rows all
        // reading "vibes", which is the repo, drowning the four real ones.
        !!recentTitle(session).trim() &&
        !isAnonymous(session) &&
        projectPicker.matches({
          project: session.project ?? undefined,
          cwd: session.cwd ?? undefined,
        }),
    );
  }, [resumable, sessions, projectPicker]);

  /**
   * OPEN FINDINGS, FILTERED DOWN TO THIS PROJECT.
   *
   * Findings obey the project filter like everything else on this screen —
   * scoped through the OWNING AGENT's repo (the machine already resolves
   * worktree cwds to it; see withAutoAgentMeta), because a finding carries no
   * project of its own. `selectHomeAutoFindings` then lays the scoped
   * findings out one row each, worst severity first — see auto-agents.ts for
   * why there is no roster here to filter down from.
   */
  const autoRows = useMemo(() => {
    const byAgentId = new Map(autoAgents.map((agent) => [agent.id, agent]));
    const scoped = autoFindings.filter((finding) => {
      const agent = byAgentId.get(finding.agentId);
      return projectPicker.matches({
        project: agent?.project ?? undefined,
        cwd: agent?.cwd ?? undefined,
      });
    });
    return selectHomeAutoFindings(autoAgents, scoped);
  }, [autoAgents, autoFindings, projectPicker]);

  const openSession = (id: string | null) => {
    if (!id) return;
    void Haptics.selectionAsync();
    router.push(`/session/${id}`);
  };

  /**
   * The composer Start button. Same request the web's composer sends
   * (POST /api/sessions/new), now carrying both choices explicitly instead of
   * letting the server pick the agent and the binding pick the folder.
   */
  /**
   * `spoken` comes straight from a finished dictation take, because the state
   * update carrying it has not committed at the moment the take ends —
   * reading `draft` there starts a session with an empty prompt.
   */
  const startSession = useCallback(async (spoken?: string) => {
    const prompt = attachments.compose((spoken ?? draft).trim());
    if (!prompt || !client || starting) return;
    setStarting(true);
    try {
      const res = await client.transport.request<{ sessionId?: string }>("/api/sessions/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          agent: agentPicker.agent,
          // Omitted unless it was actually chosen: the box's own default is a
          // better answer than a model this app guessed at.
          model: agentPicker.model ?? undefined,
          // Omitted unless chosen: the box has its own default per agent, and
          // sending a level it does not recognise is a 400 rather than a
          // fallback.
          thinkingLevel: agentPicker.thinking ?? undefined,
          cwd: projectPicker.cwd ?? undefined,
        }),
      });
      setDraft("");
      attachments.clear();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
      if (res?.sessionId) router.push(`/session/${res.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [
    attachments,
    client,
    agentPicker.agent,
    agentPicker.model,
    projectPicker.cwd,
    draft,
    starting,
    load,
    router,
  ]);

  // Kept current for the dictation callback declared above it.
  useEffect(() => {
    startRef.current = (prompt: string) => void startSession(prompt);
  }, [startSession]);

  /**
   * Archive one session, the gesture the row itself commits to.
   *
   * This replaces "Smart clear", which was a text button in a section header
   * that archived EVERY idle session behind one confirm. That is a bulk
   * destructive action reachable by a single tap next to the rows it destroys,
   * offered on a phone, where the thing people actually want is to get rid of
   * ONE row. Swiping a row archives that row, which is both the iOS idiom and
   * the operation people were reaching for.
   *
   * Same endpoint the session screen's own Archive uses, scoped to one id, so
   * there is one archive path rather than a per-row special case. No confirm
   * dialog: a deliberate swipe past a threshold IS the confirmation, and an
   * archived session can be resumed.
   */
  const archiveSession = useCallback(
    (sessionId: string | null) => {
      if (!client || !sessionId) return;
      // Drop the row immediately. The request is not instant, and leaving a
      // card that has just been swiped away sitting on screen until the server
      // answers reads as the gesture having failed.
      setSessions((current) => current.filter((s) => s.sessionId !== sessionId));
      void (async () => {
        try {
          await client.transport.request("/api/sessions/close-all", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: "mobile_swipe_archive",
              scope: "idle",
              sessionIds: [sessionId],
            }),
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          // Re-read either way: on success this confirms the removal, and on
          // failure it puts the row back rather than leaving the list lying.
          await load();
        }
      })();
    },
    [client, load],
  );

  /**
   * DISMISS. The finding said its piece; the user doesn't want to act on it.
   *
   * Delegates to `setFindingStatus`, which owns the optimistic removal and
   * the real request (POST /api/auto/findings/{id} {status:"dismissed"}) —
   * the same status change the web's Dismiss button sends. There is
   * deliberately no local-only hide: a dismiss that reappears on next launch
   * because it never reached the server is worse than no dismiss at all.
   */
  const dismissFinding = useCallback(
    (findingId: string) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void setAutoFindingStatus(findingId, "dismissed");
    },
    [setAutoFindingStatus],
  );

  /**
   * Which finding is graduating into a session right now. ONE at a time — a
   * finding launches into the composer's own /api/sessions/new call, and the
   * button that fired it is the only one that should show a spinner.
   */
  const [startingFindingId, setStartingFindingId] = useState<string | null>(null);

  /**
   * START SESSION. The one-tap path web calls "Make the change": no typed
   * instruction, just "go implement the suggested fix" — a phone has no room
   * for the web sheet's launch-settings picker, so this launches on the
   * finding's OWN agent's backend/model/cwd, the same defaults the web falls
   * back to when nothing is overridden.
   *
   * Composes the same reference text `replyToFinding` sends in
   * web/src/App.tsx (agent name, title, reasoning, suggestion, then the
   * instruction) so a session graduated from mobile reads identically to one
   * graduated from the web. Marks the finding `session` — not `dismissed` —
   * so its lifecycle in src/auto/store.ts correctly says WHY it left the open
   * list, and navigates to the new session the same way the composer's own
   * Start button does.
   */
  const startSessionFromFinding = useCallback(
    async (row: AutoFindingRow) => {
      if (!client || startingFindingId) return;
      const { finding, agent } = row;
      setStartingFindingId(finding.id);
      const prompt = [
        `An automated watch agent ("${agent?.name ?? "Auto agent"}") flagged this:`,
        "",
        finding.title,
        ...(finding.reasoning?.length ? ["", "Reasoning:", ...finding.reasoning.map((r) => `- ${r}`)] : []),
        ...(finding.suggest ? ["", `Suggested fix: ${finding.suggest}`] : []),
        "",
        "Now do this: Go ahead and implement this fix now.",
      ].join("\n");
      try {
        const res = await client.transport.request<{ sessionId?: string }>("/api/sessions/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            title: finding.title.trim().slice(0, 200),
            agent: agent?.agent ?? undefined,
            model: agent?.model ?? undefined,
            cwd: agent?.cwd ?? undefined,
          }),
        });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await setAutoFindingStatus(finding.id, "session");
        await load();
        if (res?.sessionId) router.push(`/session/${res.sessionId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStartingFindingId(null);
      }
    },
    [client, startingFindingId, setAutoFindingStatus, load, router],
  );

  /**
   * The bar is the system's, not ours.
   *
   * This screen used to draw its own row — mark, machine chip, gear — because
   * KeyboardAvoidingView measures against its PARENT, so a native header would
   * have needed its height fed back as `keyboardVerticalOffset`. Moving the
   * keyboard to `useAnimatedKeyboard` removed that constraint entirely: the
   * lift is driven by the real keyboard frame and does not care what sits
   * above it. So the header is now a real UINavigationBar with the system
   * large title, which collapses on scroll, carries the system material, and
   * matches every other iOS app for free.
   *
   * Set here rather than in _layout.tsx because the right-hand items need this
   * screen's machine state, and the deps below are what keep them current.
   */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      /**
       * NO TITLE, large or small.
       *
       * "Sessions" was a 34pt word naming the only screen the app opens on,
       * costing a fifth of the viewport to say something the content already
       * says: a list of sessions, under a "WORKING" header, in an app whose
       * icon you just tapped. The list starts at the top of the screen now
       * and the bar is left to the two controls that do something.
       */
      headerLargeTitle: false,
      title: "",
      /**
       * The greeting sits ON the bar, level with the two buttons — the row the
       * web puts it in.
       *
       * It spent a version as page content because iOS 26 wraps bar items in a
       * glass capsule and a sentence inside one looked like a control. That is
       * per-ITEM, not per-bar: `hidesSharedBackground` opts this one out, so
       * the greeting is plain text on the bar and the buttons opposite keep
       * their glass.
       */
      unstable_headerLeftItems: () => [
        {
          type: "custom",
          hidesSharedBackground: true,
          element: (
            <LiveWelcome
              firstName={firstName}
              busyCount={flattenNodes(working).length}
              onPress={() => router.push("/notifications")}
            />
          ),
        },
      ],
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          {/* The greeting is the door on the web, but a sentence inside a
              custom bar item does not reliably take a tap on iOS — verified on
              the simulator, twice. A bar BUTTON does, so the Notification
              Center gets one of its own. */}
          <IconButton
            ios="bell"
            android="notifications"
            accessibilityLabel="Notifications"
            onPress={() => router.push("/notifications")}
            size={19}
            color={colors.textSecondary}
          />
          {/* Bots. Same idiom as the bell/computer/gear beside it — a plain
              bar button pushing a full screen — rather than the web's rail
              toggle, which this app has no rail to hang. See
              app/bots/index.tsx for the navigation reasoning. Lucide, not an
              SF Symbol: `person.and.background.dotted` and friends read as
              "people," not "a bot," and this app already reaches for Lucide
              exactly when SF Symbols has no honest equivalent (lucide.tsx). */}
          <IconButton
            lucide="bot"
            accessibilityLabel="Bots"
            onPress={() => router.push("/bots")}
            size={19}
            color={colors.textSecondary}
          />
          {/* TWO BUTTONS, NOT ONE CHIP.
              The machine name and the gear used to share a single pill, which
              read as one control and made the name look pressable-adjacent
              rather than pressable. Split, each is a glyph on its own disc —
              the shape iOS 26 gives bar items — and the machine's name moves
              into the menu, where the checkmark already says which one is
              current. The dot keeps the one thing the name was really
              carrying: whether that machine is up. */}
          <DropdownMenu title="Computer" options={computerPicker.options}>
            <View
              accessibilityRole="button"
              accessibilityLabel={`Computer: ${machineName}. Change`}
              style={{
                width: 36,
                height: 36,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <LucideIcon name="monitor" size={20} color={colors.textSecondary} />
              <View
                style={{
                  position: "absolute",
                  // Bottom-trailing of the glyph box, the corner UIKit badges
                  // from, clear of the monitor's stand.
                  right: 6,
                  bottom: 6,
                }}
              >
                <StatusDot busy={currentBinding?.online ?? false} size={7} />
              </View>
            </View>
          </DropdownMenu>
          <IconButton
            lucide="settings"
            accessibilityLabel="Settings"
            onPress={() => router.push("/settings")}
            size={20}
            color={colors.textSecondary}
          />
        </View>
      ),
    });
  }, [
    navigation,
    router,
    computerPicker.options,
    machineName,
    currentBinding?.online,
    firstName,
    working.length,
    colors,
    space,
  ]);

  // The composer floats over the list rather than sitting under it, so the
  // list has to know how tall it is. Measured rather than assumed: it grows
  // with the draft.
  //
  // The measurement is real but not instant — `onLayout` only fires once the
  // composer (gated on `ready`, itself gated on the machine answering) has
  // actually laid out, and every one of those is a render after this state's
  // initial value ships. A `0` initial value meant every cold open, and every
  // return from a state where the composer was unmounted, drew the list with
  // NO clearance for a frame or more: the bottom padding read `space.md`
  // alone, and the last row (plus the "opus / Thinking / All projects" pill
  // row and the safe-area home indicator) sat under the glass until the real
  // measurement landed. `MIN_COMPOSER_HEIGHT` is a deliberately conservative
  // floor — the field's own 44pt row plus the pill row plus breathing room —
  // so the worst case is "slightly too much clearance for one frame" instead
  // of "a card and the toolbar overlap."
  const [composerHeight, setComposerHeight] = useState(() => MIN_COMPOSER_HEIGHT + insets.bottom);

  // Same UI-thread keyboard tracking as the session screen; see the note there
  // for why KeyboardAvoidingView cannot be made to feel right.
  const keyboard = useAnimatedKeyboard();
  /**
   * THE COMPOSER MOVES ITSELF, because padding never moved it.
   *
   * It is absolutely positioned so the list can scroll underneath the glass,
   * and an absolutely positioned child is laid out against its parent's BORDER
   * box — the parent's animated `paddingBottom` slides the flow content up and
   * leaves the absolute child exactly where it was. On a phone that meant the
   * keyboard came up and covered the composer completely: not just invisible,
   * but untappable, which is why the folder pill "stopped working" while the
   * keyboard was open. A translate on the composer itself is not subject to
   * any of that.
   */
  const composerLift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.value - insets.bottom) }],
  }));

  return (
    <Reanimated.View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        /**
         * The list runs UNDER the composer, which floats over it. The padding
         * is the composer's measured height, so the last session can still be
         * scrolled clear of it — a fixed number would either strand the last
         * row under the glass or leave a dead band when the composer is one
         * line tall.
         */
        contentContainerStyle={{ paddingBottom: composerHeight + space.md }}
        keyboardShouldPersistTaps="handled"
        // Scrolling the list puts the keyboard away. Reaching for the field is
        // an explicit act; scrolling past it is how you say you are done.
        keyboardDismissMode="on-drag"
        // Lets the system large title collapse into the bar on scroll, and
        // insets content below it instead of starting underneath.
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              refreshResumable();
              refreshAuto();
              void Promise.all([probe(), load(true)]).finally(() => setPulling(false));
            }}
            tintColor={colors.textMuted}
          />
        }
      >
        {(connection === "reconnecting" || connection === "offline") && ready ? (
          <Text
            style={{
              ...type.caption,
              color: colors.warning,
              paddingHorizontal: space.lg,
              paddingTop: space.xs,
            }}
          >
            Reconnecting…
          </Text>
        ) : null}

        {/* Readiness owns the screen when the machine is not serving. */}
        {!bindingId ? (
          <EmptyState
            title="No computer selected"
            detail="Choose which computer this app should talk to."
            action={
              <DropdownMenu title="Computer" options={computerPicker.options}>
                <PrimaryButton label="Choose a computer" />
              </DropdownMenu>
            }
          />
        ) : readiness?.status === "connecting" || readiness?.status === "waking" ? (
          /**
           * SAY ONLY WHAT IS KNOWN — and on a cold start, say it on the launch
           * screen instead of here.
           *
           * This block used to be the app's first frame, which meant it read
           * "Connecting to No computer…" until the bindings arrived: the
           * machine name is exactly the thing that is not loaded yet at that
           * moment. LaunchGate in app/_layout.tsx covers that window now, with
           * the mark and no name. What is left here is the SECOND time and
           * after — switching machines, or one that goes cold mid-session —
           * where the name IS known and this screen has a list to keep.
           *
           * Skeleton cards rather than a spinner: the sessions being fetched
           * already exist, and the shape of the list says "these are coming
           * back" without a word changing.
           */
          <View style={{ gap: space.lg, paddingTop: space.xl }}>
            <View style={{ alignItems: "center", gap: space.xs, paddingHorizontal: space.xl }}>
              <Text style={{ ...type.callout, color: colors.textSecondary }}>
                {readiness.status === "waking"
                  ? "Waking your computer…"
                  : `Connecting to ${machineName}…`}
              </Text>
              {readiness.status === "waking" ? (
                <Text style={{ ...type.footnote, color: colors.textMuted, textAlign: "center" }}>
                  It hibernated to save resources. This usually takes a moment.
                </Text>
              ) : null}
            </View>
            <SessionListSkeleton count={2} />
          </View>
        ) : readiness?.status === "agent-limit" ? (
          <EmptyState
            title="Too many agents running"
            detail={readiness.message}
            action={<PrimaryButton label="Try again" onPress={() => void probe()} />}
          />
        ) : readiness?.status === "unauthorized" ? (
          /**
           * NOT a connection problem — say so, and don't offer a retry that
           * cannot succeed. This is the state a revoked share (or an
           * unpaired machine still named in a stale preference) resolves to;
           * see the readiness.ts doc comment on `"unauthorized"` for the web
           * bug ("Computer not connected", read as offline) this exists to
           * not repeat. "Try again" is deliberately absent — the server has
           * already answered, and asking again gets the same answer.
           */
          <EmptyState
            title="No longer available"
            detail={
              isSharedBindingId(bindingId ?? "")
                ? SHARED_REVOKED_DETAIL
                : readiness.message
            }
            action={
              <DropdownMenu title="Computer" options={computerPicker.options}>
                <PrimaryButton label="Choose another" />
              </DropdownMenu>
            }
          />
        ) : readiness && readiness.status !== "ready" ? (
          <EmptyState
            title={
              readiness.status === "unavailable"
                ? "Your computer isn't responding"
                : "Couldn't open your computer"
            }
            detail={"message" in readiness ? readiness.message : undefined}
            action={
              <View style={{ gap: space.sm }}>
                <PrimaryButton label="Try again" onPress={() => void probe()} />
                <DropdownMenu title="Computer" options={computerPicker.options}>
                  <PrimaryButton label="Choose another" tone="quiet" />
                </DropdownMenu>
              </View>
            }
          />
        ) : !readiness ? (
          // Nothing is known yet — not even whether the machine is awake.
          // This is the state on every cold open, so it gets the full list
          // skeleton rather than a spinner on an otherwise-blank screen.
          <SessionListSkeleton style={{ paddingTop: space.xl }} />
        ) : (
          <>
            {sessions.length === 0 && loading ? (
              // First fetch on this machine, nothing on screen to disturb.
              // Once `sessions` is non-empty, RefreshControl (pull-to-refresh)
              // is the loading affordance instead — real rows must never be
              // swapped out for skeletons under someone's thumb.
              <SessionListSkeleton style={{ paddingTop: space.xl }} />
            ) : sessions.length === 0 && !loading ? (
              <EmptyState
                title="No sessions yet"
                detail="Start one below and it shows up here."
              />
            ) : null}

            {/**
             * ONE GROUP PER FOLDER.
             *
             * A folder header carries no status dot — it names a place, not a
             * state. The row's own mark still says whether that session is
             * running, which is the point: status belongs to the row, grouping
             * belongs to the folder.
             *
             * Archive is offered per NODE rather than per section. It used to
             * be a property of the Idle section — everything in it was
             * archivable because everything in it was stopped. A folder mixes
             * both, so the rule moves onto the row it was always really about:
             * a running session has nothing to archive.
             */}
            {projectGroups.map((group) => (
              <View key={group.key}>
                <SectionHeader label={group.label} count={group.count} />
                {/* 2pt, not 8. Rows are a list, not a stack of cards; the
                    fixed row height does the separating. */}
                <View style={{ gap: 2 }}>
                  {group.nodes.map((node) => {
                    const id = sessionStableId(node.session);
                    return (
                      <OverlapRow key={id} id={`${group.key}:${id}`}>
                        <SessionFamily
                          node={node}
                          onOpen={openSession}
                          onArchive={nodeBusy(node) ? undefined : archiveSession}
                          animateEntry={animateEntry}
                        />
                      </OverlapRow>
                    );
                  })}
                </View>
              </View>
            ))}

            {/**
             * WHAT NEEDS A DECISION TODAY.
             *
             * Auto agents run on a timer and report findings; a finding is
             * not a session, so it does not belong in Working or Idle, where
             * a tap opens a transcript. A swipe here still dismisses, same
             * gesture as archive, different target — see the long note atop
             * auto-agent-card.tsx for why dismiss gets both that swipe and a
             * visible button, and why "start session" only gets the button.
             * Its own section, ADDED rather than substituted: the three above
             * are untouched.
             *
             * ONE ROW PER OPEN FINDING, matching the web's own live view
             * (the "Auto" section in web/src/App.tsx) rather than a roster of
             * every scheduled agent — most of which have nothing to say right
             * now, which is exactly why the web doesn't list them here either
             * (see selectHomeAutoFindings). Nothing hands off to a "manage
             * schedules" page: there is nothing left unsaid to hand off.
             *
             * BETWEEN Idle AND Recent, and that position is the argument.
             * Working and Idle are happening now. Recent is finished and
             * read-only. An open finding is neither — it is unfinished
             * business that nothing is currently working on, which is exactly
             * the gap between the two, and putting it below Recent would bury
             * the only actionable thing on the screen under a log.
             *
             * Blue, matching the tint the web gives findings ("N open" in
             * `text-primary`) and staying clear of the amber/green/grey the
             * three session sections have already claimed.
             *
             * GATED ON `sessionsSettled`, ALONGSIDE `autoRows.length` — see
             * the long note by that flag's `useEffect` above. Auto's own
             * data is very often ready before Working/Idle's is (no
             * readiness gate on its fetch), and rendering it the moment it
             * arrives is exactly what let it paint, settle, and then get
             * shoved down when Sessions mounted its own rows late.
             */}
            {sessionsSettled && autoRows.length ? (
              <>
                <SectionHeader label="Auto" count={autoRows.length} dotColor={colors.primary} />
                <View style={{ gap: space.sm }}>
                  {autoRows.map((row) => (
                    <OverlapRow key={row.finding.id} id={`auto:${row.finding.id}`}>
                      <AutoFindingCard
                        row={row}
                        expanded={expandedAuto === row.finding.id}
                        onToggle={() =>
                          setExpandedAuto((current) =>
                            current === row.finding.id ? null : row.finding.id,
                          )
                        }
                        onDismiss={() => dismissFinding(row.finding.id)}
                        onStartSession={() => void startSessionFromFinding(row)}
                        busy={startingFindingId === row.finding.id}
                        animateEntry={animateEntry}
                      />
                    </OverlapRow>
                  ))}
                </View>
              </>
            ) : null}

            {/**
             * WORK THAT FINISHED IS STILL WORK YOU WANT TO READ.
             *
             * A session that shipped and closed used to disappear from the
             * phone entirely — the summary was in the notification centre
             * behind the bell, and the transcript behind nothing at all. This
             * is the web's "Recent sessions", in the place someone actually
             * looks: under the ones still running.
             *
             * Tapping one READS it. Resuming costs an agent process and is
             * asked for by sending a message, not by opening a row.
             *
             * Same `sessionsSettled` gate as Auto, same reason — `resumable`
             * has no readiness gate on its own fetch either.
             */}
            {sessionsSettled && recent.length ? (
              <>
                <SectionHeader label="Recent" count={recent.length} dotColor={colors.textMuted} />
                <View style={{ gap: space.sm }}>
                  {recent.map((session) => (
                    <OverlapRow key={session.sessionId} id={`recent:${session.sessionId}`}>
                      <SessionCard
                        title={recentTitle(session)}
                        // WHEN, then what was last said. A list called Recent
                        // that never says when is asking you to guess, and these
                        // rows span minutes to weeks.
                        subtitle={[relativeTime(session.lastActivityAt), session.lastUserText?.trim()]
                          .filter(Boolean)
                          .join(" · ")}
                        agent={session.agent}
                        ended
                        onPress={() => router.push(`/session/${session.sessionId}`)}
                        animateEntry={animateEntry}
                      />
                    </OverlapRow>
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* The composer only makes sense against a serving machine; readiness
          states own the whole screen until then.

          Absolute, so the list scrolls beneath the glass instead of stopping
          at a hard edge above it. `bottom: 0` is the parent's PADDING box, so
          the keyboard lift above still carries the composer up. */}
      {ready ? (
        <>
          {/* THE FADE, behind the glass rather than part of it.
              A gradient scrim in the page's own background colour, not a grey
              overlay — it has no colour of its own, it just erases toward
              `colors.bg` — so a scrolling card dissolves into the page
              instead of visibly darkening under a tint. `pointerEvents="none"`
              because it is paint, not surface: taps must reach the list
              underneath right up to the composer's own hit area. Sized off
              `composerHeight` (not a fixed guess) and carried by the same
              `composerLift` as the composer, so the dissolve always ends
              exactly at the glass, keyboard up or down. */}
          <Reanimated.View
            pointerEvents="none"
            style={[
              { position: "absolute", left: 0, right: 0, bottom: 0, height: composerHeight + COMPOSER_FADE_HEIGHT },
              composerLift,
            ]}
          >
            <LinearGradient
              {...composerFadeStops(colors.bg)}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={{ flex: 1 }}
            />
          </Reanimated.View>
        <Reanimated.View
          style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, composerLift]}
          /**
           * NEVER SHRINK THE RESERVATION, only grow it.
           *
           * The composer's own first layout pass can land BEFORE the things
           * that widen its pill row — `agentPicker`/`projectPicker` options
           * resolve from the machine, `usage` rings arrive from a separate
           * fetch (see `usageLoading` above) — so an early `onLayout` can
           * measure a shorter composer than the one actually on screen a
           * moment later, once those pills populate. Overwriting
           * `composerHeight` on every measurement trusts that later growth
           * re-fires `onLayout` and corrects itself — which it normally does —
           * but the one time it lands late (a slow response, a re-render that
           * coalesces with the resize) is the one time the pill row —
           * "opus / Thinking / All projects" — sits on top of whatever card
           * has scrolled to the bottom. Taking the max instead means a later,
           * taller measurement still wins, and an earlier, larger one (e.g. a
           * longer agent name that later shortens) only costs a little unused
           * clearance rather than risking a covered row.
           */
          onLayout={(e) => {
            const measured = e.nativeEvent.layout.height;
            setComposerHeight((current) => Math.max(current, measured));
          }}
        >
        <HomeComposer
          value={draft}
          onChangeText={setDraft}
          onStart={() => void startSession()}
          starting={starting}
          // null, not the "All projects" label — the pill collapses to a bare
          // folder when nothing is scoped. See ComposerCaptionButton.
          projectLabel={projectPicker.filter === ALL_PROJECTS ? null : projectPicker.label}
          projectOptions={projectPicker.options}
          agent={agentPicker.agent}
          agentLabel={agentPicker.label}
          agentOptions={agentPicker.options}
          modelLabel={agentPicker.modelLabel}
          modelOptions={agentPicker.modelOptions}
          thinkingLabel={agentPicker.thinkingLabel}
          thinkingOptions={agentPicker.thinkingOptions}
          attachments={attachments}
          dictation={dictation}
          usage={usage}
          usageLoading={usageLoading}
          bottomInset={insets.bottom}
        />
        </Reanimated.View>
        </>
      ) : null}
    </Reanimated.View>
  );
}
