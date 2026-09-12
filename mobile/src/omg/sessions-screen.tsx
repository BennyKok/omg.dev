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

import {
  type Href,
  useFocusEffect,
  useNavigation,
  useRouter,
  usePathname,
} from "expo-router";
import * as Haptics from "expo-haptics";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import Reanimated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { COMPOSER_FADE_HEIGHT, EdgeFade, fadeStops, TOP_FADE_HEIGHT } from "./edge-fade";
import { keyCommandsAvailable, useKeyCommand } from "./key-commands";
import { ShortcutsSheet } from "./shortcuts-sheet";
import { FolderRailSheet } from "./folder-rail-sheet";
import { CreateSheet } from "./create-sheet";
import { Text } from "./text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OmgSession } from "@omg-dev/protocol";
import type { OmgConnectionStatus } from "@omg-dev/client";

import {
  EmptyState,
  Icon,
  SESSION_ROW,
  HomeComposer,
  PrimaryButton,
  SectionHeader,
  SessionCard,
} from "../components";
import { useAttachments } from "./attachments";
import {
  buildSessionTree,
  flattenNodes,
  nodeBusy,
  sessionStableId,
  type SessionNode,
} from "./session-tree";
import { AutoReportRow } from "./auto-agent-card";
import { canDriveSession, type DriveableSession } from "./session-runtime";
import { useOverlapWatch } from "./list-overlap-watch";
import { groupNodesByProject } from "./session-groups";
import { observeSessionStatus, SessionStatusState } from "./session-status";
import { sessionPreview } from "./session-preview";
import { SubagentGroup } from "./subagent-group";
import {
  groupHomeAutoFindings,
  selectHomeAutoFindings,
  useAutoAgents,
  type AutoFindingRow,
} from "./auto-agents";
import { useComputerPicker } from "./computer-picker";
import { SideNavButton, SideNavDrawer, SideNavPanel, sideNavWidth } from "./side-nav";
import {
  clearSessionUnread,
  fetchSessionsForViewer,
  sameUnreadSessions,
  type UnreadSessionRow,
} from "./session-unread";
import { UserFilterMenu } from "./user-filter-menu";
import {
  sessionMatchesUserFilter,
  useUserFilter,
  useUserRoster,
  type RosterUser,
} from "./users";
import { useDictation } from "./dictation";
import { PressableScale } from "./motion";
import { useUsage } from "./usage";
import { DropdownMenu } from "./menu";
import { useAgentPicker, useProjectPicker } from "./session-options";
import { useOmg } from "./provider";
import { useToast } from "./toast";
import { SessionListSkeleton } from "./skeleton";
import { useTheme } from "./theme";
import { bindingLabel, relativeTime } from "./format";
import { CLOUD_BINDING_ID } from "./config";
import {
  isSharedBindingId,
  SHARED_REVOKED_DETAIL,
  sharedBindingLabel,
} from "./computer-shared-binding";

/**
 * A session once a named bot drives it. `botId` is populated on every session
 * the server lists, but is not yet part of @omg-dev/protocol's OmgSession —
 * same situation as the local type in app/bots/index.tsx — so it is read off
 * the wire value with a narrow cast.
 */
type BotDrivenSession = OmgSession & { botId?: string };

/**
 * A listed session, plus the read state the box stamps on it.
 *
 * `unread` is not in @omg-dev/protocol's OmgSession — the same narrow cast the
 * web uses for the same field (web/src/lib/session-unread.ts), and for the same
 * reason: the flag is a property of the ANSWER to one viewer's list request,
 * not of the session.
 */
type ListedSession = OmgSession & UnreadSessionRow;

/**
 * Which sessions hold a reply this person has not read.
 *
 * The roster owns read state. Parent rows and expanded subagent cards read
 * the same set, so collapsing a family cannot hide its unread indicator.
 */
const SessionUnreadContext = createContext<Set<string>>(new Set());

/** A parent row with its subagents behind a compact, expandable stack. */
function SessionFamily({
  node,
  onOpen,
  onArchive,
  animateEntry = true,
}: {
  node: SessionNode;
  onOpen: (id: string | null) => void;
  onArchive?: (id: string | null) => void;
  /** See the identical prop on SessionCard/AutoFindingCard for why. */
  animateEntry?: boolean;
}) {
  const { colors, radius } = useTheme();
  const session = node.session;
  // Only the iPad rail has a current row: the list stays on screen beside
  // the open session. On a phone the list is a screen you come BACK to, and
  // a row still tinted then reads as a stuck press, not a selection.
  const pathname = usePathname();
  const selected = Platform.OS === "ios" && Platform.isPad && pathname === `/session/${session.sessionId}`;
  // Read state is the roster's, from the server's own watermark. A working
  // session is never in the set: the box holds the mark back while a turn is
  // running, because the dot means "ready for you" and a session mid-turn is
  // not. See withSessionUnread in src/commands/serve.ts.
  const unreadSessions = useContext(SessionUnreadContext);
  const unread = !!session.sessionId && unreadSessions.has(session.sessionId);

  return (
    <View style={{ alignSelf: "stretch" }}>
      <View>
        {/* THE SELECTED ROW IS A FLAT TINT. It spent one commit as a white
            card with a hairline and a drop shadow, and one card in a list of
            flat rows read as a different kind of object rather than the same
            row, chosen. The tint sits on the row's own bounds and radius,
            drawn behind rather than around, so the row's geometry (and the
            tree lines that aim at its mark) stay untouched. */}
        {selected ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: SESSION_ROW.inset,
              right: SESSION_ROW.inset,
              borderRadius: radius.md,
              backgroundColor: colors.accent,
            }}
          />
        ) : null}
        <SessionCard
          title={session.title || session.lastUserText || "Untitled session"}
          subtitle={sessionPreview(session)}
          timestamp={relativeTime(session.lastActivityAt ?? session.startedAt)}
          agent={session.agent ?? session.agentLabel}
          busy={!!session.busy}
          blocked={session.status === "blocked"}
          unread={unread}
          onPress={() => onOpen(session.sessionId)}
          onArchive={
            onArchive
              ? () => onArchive(session.sessionId)
              : undefined
          }
          animateEntry={animateEntry}
        />
      </View>

      {node.children.length ? (
        <SubagentGroup
          nodes={node.children}
          unreadSessions={unreadSessions}
          onOpen={onOpen}
        />
      ) : null}
    </View>
  );
}

/**
 * A conservative floor for the composer's height, before it has been
 * measured — see `composerHeight` below. The real composer is at least the
 * 52pt field row plus its outer spacing;
 * this rounds up rather than down so a stale estimate over-clears the list
 * instead of letting a row sit under the glass.
 */
const MIN_COMPOSER_HEIGHT = 76;

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
  connection,
  onPress,
}: {
  firstName: string;
  busyCount: number;
  /** Live-socket health. A drop takes over the greeting, as the web's status text does. */
  connection?: OmgConnectionStatus;
  /** The greeting is the door to the Notification Center, as on the web. */
  onPress?: () => void;
}) {
  const { colors, type } = useTheme();
  const dropped = connection === "reconnecting" || connection === "offline";
  const [showActivity, setShowActivity] = useState(false);

  useEffect(() => {
    if (!busyCount) {
      setShowActivity(false);
      return;
    }
    const timer = setTimeout(
      () => setShowActivity((current) => !current),
      showActivity ? 2800 : 8000,
    );
    return () => clearTimeout(timer);
  }, [busyCount, showActivity]);

  const welcome = firstName ? `Welcome, ${firstName}` : "Welcome";
  const activity = `${busyCount} agent${busyCount === 1 ? "" : "s"} building`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
      <Text
        numberOfLines={1}
        style={{ ...type.headline, color: dropped ? colors.warning : colors.text, maxWidth: 210 }}
      >
        {dropped ? "Reconnecting…" : busyCount > 0 && showActivity ? activity : welcome}
      </Text>
    </Pressable>
  );
}

/**
 * The trailing control on the home header: the roster filter, and only the
 * roster filter.
 *
 * It used to carry an "ellipsis" overflow menu beside it holding
 * Notifications, Schedules, Settings and the shortcuts card, and the machine
 * switcher led the bar on the other side. Those are places, not filters, and
 * they live in the side nav now (side-nav.tsx) — one column that says what it
 * holds, instead of four screens behind a glyph that says nothing. What is
 * left here is the one control that changes what the LIST shows.
 *
 * Still one component, so the phone's nav bar and the iPad rail carry the
 * same row.
 */
function HomeHeaderControls({
  userFilter,
  rosterUsers,
  setUserFilter,
}: {
  userFilter: string;
  rosterUsers: RosterUser[];
  setUserFilter: (next: string) => void;
}) {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <UserFilterMenu
        value={userFilter}
        users={rosterUsers}
        onChange={setUserFilter}
      />
    </View>
  );
}

/**
 * The list screen owns the draft and the two choices that go with it; the
 * pickers own which options exist and which one is current. See
 * session-options.ts for why neither selection is persisted.
 */
export function SessionsScreen({
  children,
  workspace = false,
}: {
  children?: ReactNode;
  workspace?: boolean;
}) {
  const pathname = usePathname();
  const { width, height: windowHeight } = useWindowDimensions();
  const wide = workspace && width >= 768;
  const home = pathname === "/";
  const railWidth = wide ? 320 : 0;
  const router = useRouter();
  const navigateWorkspace = (href: Href) => {
    if (href === "/") router.dismissTo("/");
    else if (home) router.push(href);
    else router.replace(href);
  };

  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, type, space, radius } = useTheme();
  const {
    client,
    readiness,
    probe,
    bindingId,
    bindings,
    sharedComputers,
    user,
  } = useOmg();
  const computerPicker = useComputerPicker();
  // No session exists yet, so these upload to the pre-session endpoint and
  // ride along in the prompt that creates one.
  const attachments = useAttachments(null);
  // Already one entry per agent rather than per login: the machine folds them
  // now (`/api/usage/summary`), and useUsage only does it itself when talking
  // to a box too old to have that endpoint.
  const { providers: usage, loading: usageLoading } = useUsage();
  const {
    agents: autoAgents,
    findings: autoFindings,
    refresh: refreshAuto,
    setFindingStatus: setAutoFindingStatus,
  } = useAutoAgents();
  const agentPicker = useAgentPicker();
  const projectPicker = useProjectPicker();
  const rosterUsers = useUserRoster();
  const [userFilter, setUserFilter] = useUserFilter(rosterUsers);

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
  // Which agent's report is open. One at a time, like the finding cards.
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
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
   * | offline. The focused fleet subscription opens the shared socket.
   * Only a genuine drop is worth saying out loud.
   */
  const [connection, setConnection] =
    useState<OmgConnectionStatus>("connecting");
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

  /** Keep unchanged rows stable across REST reconciliations and status frames. */
  function sessionsSignature(list: OmgSession[]): string {
    return JSON.stringify(
      list.map((s) => [
        s.sessionId,
        s.nativeSessionId,
        s.tmuxName,
        s.title,
        s.lastUserText,
        s.lastActivityAt,
        s.agent,
        s.agentLabel,
        s.busy,
        s.status,
        s.statusReason,
        s.statusDetail,
        s.parentSessionId,
        s.parentNativeSessionId,
        s.model,
      ]),
    );
  }
  const sessionsSignatureRef = useRef<string | null>(null);
  const currentClient = useRef(client);
  currentClient.current = client;
  const statusState = useMemo(() => new SessionStatusState((fresh) => {
    if (currentClient.current !== client) return;
    const signature = sessionsSignature(fresh);
    if (signature !== sessionsSignatureRef.current) {
      sessionsSignatureRef.current = signature;
      setSessions(fresh);
    }
  }), [client]);
  const previousBinding = useRef(bindingId);
  useEffect(() => {
    sessionsSignatureRef.current = null;
    setSessions([]);
    setSessionsSettled(false);
    setLoading(false);
    setError(null);
    if (workspace && previousBinding.current !== bindingId)
      router.dismissTo("/");
    previousBinding.current = bindingId;
  }, [bindingId, workspace, router]);

  /**
   * WHICH SESSIONS HOLD A REPLY THIS PERSON HAS NOT READ.
   *
   * Its own set, never a field on the rows — see session-unread.ts. Live
   * status frames and optimistic local edits both write rows that have never
   * seen a read watermark, and a flag carried on the row blinked off on the
   * next one of those. This set is only ever replaced by a full list payload,
   * which is the only thing that knows.
   */
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(() => new Set());
  /** Whose watermark. The same identity the web asks with: the signed-in email. */
  const viewer = user?.email ?? null;
  // Read inside an async callback that may outlive the selection it started
  // under — see the guard in listSessionsForViewer.
  const currentViewer = useRef(viewer);
  currentViewer.current = viewer;
  useEffect(() => {
    // A different person (or a sign-out) has a different answer, and keeping
    // the old dots until the next poll would show them somebody else's.
    setUnreadSessions((current) => (current.size ? new Set() : current));
  }, [viewer, bindingId]);

  /**
   * The session list, ASKED FOR AS A NAMED VIEWER.
   *
   * `client.listSessions()` cannot carry one yet (the SDK has no viewer
   * argument), and read state is per person: a list fetched without an
   * identity is answered against a DIFFERENT watermark than the one the chat
   * screen's "mark read" write advances, so the two would take turns every
   * few seconds. So this one call goes through the transport with the viewer
   * on the query, which is all the SDK call does anyway. If `listSessions`
   * grows a viewer option, this should become that call again.
   *
   * The unread set is harvested here, in the one place a FULL payload lands.
   */
  const listSessionsForViewer = useCallback(async (): Promise<OmgSession[]> => {
    if (!client) return [];
    return await fetchSessionsForViewer<ListedSession>({
      transport: client.transport,
      viewer,
      // A slow answer for the machine, or the person, this screen has since
      // moved off carries somebody else's read state. The rows still come
      // back for `load` to judge; the DOTS do not.
      stillCurrent: () =>
        currentClient.current === client && currentViewer.current === viewer,
      // Same ids, same set: the list is polled every few seconds and almost
      // always says the same thing, and a new set identity would re-render
      // every row on a timer.
      onUnread: (next) =>
        setUnreadSessions((current) =>
          sameUnreadSessions(current, next) ? current : next,
        ),
    });
  }, [client, viewer]);

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
        await statusState.refresh(() => listSessionsForViewer());
        if (currentClient.current !== client) return;
        setError(null);
      } catch (e) {
        // A failed background poll keeps the list it already has. Only a
        // refresh someone ASKED for is worth an error banner.
        if (currentClient.current !== client) return;
        if (!quiet) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (currentClient.current !== client) return;
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
    [client, ready, statusState, listSessionsForViewer],
  );

  /**
   * WHY AUTO CAN PAINT BEFORE THE SESSION LIST, AND WHY THAT IS THE BUG.
   *
   * `load()` above gates on `ready` — the machine's own wake/probe round
   * trip has to finish before it even ATTEMPTS `client.listSessions()`.
   * `useAutoAgents()` (above) gates its own fetch on nothing but the API
   * client existing — no readiness check — so on a machine that needs
   * waking, Auto's request is already in flight, and often already
   * answered, while Sessions hasn't started yet. The result: on the first
   * render where `ready` flips true, Auto can already have rows to show
   * while the folder groups are still empty — and then Sessions resolves a
   * beat later and mounts a batch of rows ABOVE Auto, shoving it down
   * mid-settle. list-overlap-watch.tsx
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
    const timer = setTimeout(
      () => setSessionsSettled(true),
      SESSIONS_SETTLE_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [ready, sessionsSettled]);

  // Observe the fleet only while Home is visible and the app is foregrounded.
  // REST reconciles membership every minute, or every 10s without live frames.
  useFocusEffect(
    useCallback(() => {
      if (!client || !ready) return;
      let stop: (() => void) | undefined;
      const start = () => {
        if (stop) return;
        const unsubscribe = observeSessionStatus({
          live: client.live,
          apply: (rows) => statusState.apply(rows),
          refresh: (quiet) => { void load(quiet); },
          connectionChanged: setConnection,
        });
        stop = () => { unsubscribe(); stop = undefined; };
      };
      if (AppState.currentState !== "background") start();
      const appState = AppState.addEventListener("change", (state) => {
        if (state === "background") stop?.();
        else if (state === "active") start();
      });
      return () => { appState.remove(); stop?.(); };
    }, [client, ready, load, statusState]),
  );

  const currentSharedComputer = useMemo(
    () => sharedComputers.find((c) => c.id === bindingId) ?? null,
    [sharedComputers, bindingId],
  );
  const currentBinding = useMemo(
    () =>
      bindings.find((b) => b.id === bindingId) ?? currentSharedComputer ?? null,
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
   * BOT-OWNED SESSIONS BELONG TO /bots, NOT TO THIS LIST.
   *
   * A session carries `botId` once a named bot drives it, and a delegated
   * child inherits its parent's id (src/sessions.ts propagates it down the
   * lineage), so testing the field alone removes the whole family. Filtered
   * HERE, before buildSessionTree, rather than at each call site: this is the
   * single answer to "which sessions does the home screen show", and the
   * empty-state checks below read it too. Filtering roots after the tree was
   * built would strand a bot child whose parent is not in the list.
   *
   * `botId` is on the wire (src/sessions.ts sets it on every listed session)
   * but is not yet declared on @omg-dev/protocol's OmgSession, so it is read
   * with the same narrow cast already used in app/bots/index.tsx.
   */
  const visibleSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !(session as BotDrivenSession).botId &&
          // The web's rule (session-runtime.ts): a session no client can
          // drive is not listed. The phone used to show them and every
          // archive on one answered "not in a tmux pane".
          canDriveSession(session as DriveableSession) &&
          sessionMatchesUserFilter(session, userFilter),
      ),
    [sessions, userFilter],
  );

  /**
   * Families, not rows. A session that spawned subagents owns them, and the
   * family travels together — see session-tree.ts for why the parent's own
   * flag is not enough to describe it.
   */
  const roots = useMemo(
    () =>
      buildSessionTree(
        visibleSessions.filter((session) => projectPicker.matches(session)),
      ),
    [visibleSessions, projectPicker],
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
    /**
     * The dot goes out as the transcript opens, not a round trip later.
     *
     * LOCAL ONLY. The WRITE that advances the watermark belongs to the chat
     * screen, which is the surface that can tell whether the reply was
     * actually shown (foregrounded, focused, scrolled to the bottom). So if
     * the session is opened and never read, the next full list payload brings
     * the dot back — which is the honest answer, not a bug.
     */
    setUnreadSessions((current) => clearSessionUnread(current, id));
    if (workspace) navigateWorkspace(`/session/${id}`);
    else router.push(`/session/${id}`);
  };

  /**
   * HARDWARE KEYBOARD, mostly the iPad. The bindings mirror the web's where
   * a phone-sized screen has the same object: ⌘N new, ⌘↑/⌘↓ step through
   * the list, ⌘1…9 open the nth, ⌘, settings, ⌘/ the card that lists them.
   * Every hook is a no-op on a binary without the native module, so an OTA
   * carrying this is safe on older installs. The list order is the rail's.
   */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** The phone's side nav. The iPad's wide layout keeps the same rows on screen. */
  const [navOpen, setNavOpen] = useState(false);
  const navProgress = useSharedValue(0);
  const drawerWidth = sideNavWidth(width);
  const navPageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: wide ? 0 : drawerWidth * navProgress.value }],
    borderTopLeftRadius: wide ? 0 : 40 * navProgress.value,
    borderBottomLeftRadius: wide ? 0 : 40 * navProgress.value,
  }));
  const [railSheetOpen, setRailSheetOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const orderedSessionIds = useMemo(
    () => flattenNodes(roots).map((session) => session.sessionId),
    [roots],
  );
  const currentSessionId = pathname.startsWith("/session/") ? pathname.slice("/session/".length) : null;
  const goTo = (href: Href) => {
    if (workspace) navigateWorkspace(href);
    else router.push(href);
  };
  const stepSession = (delta: 1 | -1) => {
    const ids = orderedSessionIds;
    if (!ids.length) return;
    const at = currentSessionId ? ids.indexOf(currentSessionId) : -1;
    const next = at < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, at + delta));
    if (ids[next] && ids[next] !== currentSessionId) openSession(ids[next]);
  };
  useKeyCommand({ key: "n" }, () => goTo("/"));
  useKeyCommand({ key: { special: "up" } }, () => stepSession(-1));
  useKeyCommand({ key: { special: "down" } }, () => stepSession(1));
  useKeyCommand({ key: "1" }, () => openSession(orderedSessionIds[0] ?? null));
  useKeyCommand({ key: "2" }, () => openSession(orderedSessionIds[1] ?? null));
  useKeyCommand({ key: "3" }, () => openSession(orderedSessionIds[2] ?? null));
  useKeyCommand({ key: "4" }, () => openSession(orderedSessionIds[3] ?? null));
  useKeyCommand({ key: "5" }, () => openSession(orderedSessionIds[4] ?? null));
  useKeyCommand({ key: "6" }, () => openSession(orderedSessionIds[5] ?? null));
  useKeyCommand({ key: "7" }, () => openSession(orderedSessionIds[6] ?? null));
  useKeyCommand({ key: "8" }, () => openSession(orderedSessionIds[7] ?? null));
  useKeyCommand({ key: "9" }, () => openSession(orderedSessionIds[8] ?? null));
  useKeyCommand({ key: "," }, () => goTo("/settings"));
  useKeyCommand({ key: "/" }, () => setShortcutsOpen(true));
  useKeyCommand(
    { key: { special: "escape" }, modifier: "none" },
    // One escape, one layer: the card on top of the nav, then the nav.
    shortcutsOpen
      ? () => setShortcutsOpen(false)
      : navOpen
        ? () => setNavOpen(false)
        : null,
  );

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
  /**
   * The create card's way in: the same request as Start, with the prompt
   * and folder handed over instead of read from the composer and the rail.
   */
  const launch = useCallback(
    async ({ prompt, cwd }: { prompt: string; cwd: string }) => {
      if (!client) throw new Error("No machine selected");
      const res = await client.transport.request<{ sessionId?: string }>("/api/sessions/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          agent: agentPicker.agent,
          model: agentPicker.model ?? undefined,
          thinkingLevel: agentPicker.thinking ?? undefined,
          cwd,
        }),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
      if (res?.sessionId) openSession(res.sessionId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, agentPicker.agent, agentPicker.model, agentPicker.thinking, load],
  );

  const startSession = useCallback(
    async (spoken?: string) => {
      const prompt = attachments.compose((spoken ?? draft).trim());
      if (!prompt || !client || starting) return;
      setStarting(true);
      try {
        const res = await client.transport.request<{ sessionId?: string }>(
          "/api/sessions/new",
          {
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
          },
        );
        setDraft("");
        attachments.clear();
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        await load();
        if (res?.sessionId) router.push(`/session/${res.sessionId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStarting(false);
      }
    },
    [
      attachments,
      client,
      agentPicker.agent,
      agentPicker.model,
      projectPicker.cwd,
      draft,
      starting,
      load,
      router,
    ],
  );

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
      statusState.remove(sessionId);
      void (async () => {
        try {
          await client.transport.request(`/api/sessions/${encodeURIComponent(sessionId)}/close`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source: "mobile_swipe_archive" }),
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
    [client, statusState, load],
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
  const [startingFindingId, setStartingFindingId] = useState<string | null>(
    null,
  );

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
        ...(finding.reasoning?.length
          ? ["", "Reasoning:", ...finding.reasoning.map((r) => `- ${r}`)]
          : []),
        ...(finding.suggest ? ["", `Suggested fix: ${finding.suggest}`] : []),
        "",
        "Now do this: Go ahead and implement this fix now.",
      ].join("\n");
      try {
        const res = await client.transport.request<{ sessionId?: string }>(
          "/api/sessions/new",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              title: finding.title.trim().slice(0, 200),
              agent: agent?.agent ?? undefined,
              model: agent?.model ?? undefined,
              cwd: agent?.cwd ?? undefined,
            }),
          },
        );
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
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
    if (workspace) return;
    navigation.setOptions({
      headerShown: true,
      headerTransparent: true,
      // No tint of its own: the top EdgeFade below the bar is what keeps its
      // controls readable, the same paint the composer gets at the bottom.
      headerStyle: { backgroundColor: "transparent" },
      headerBlurEffect: "none",
      headerShadowVisible: false,
      scrollEdgeEffects: {
        top: "hidden",
        bottom: "hidden",
        left: "hidden",
        right: "hidden",
      },
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
      /**
       * THE BAR EMPTIES WHILE THE NAV IS OPEN.
       *
       * The drawer is an ordinary view inside this screen, not a modal (see
       * side-nav.tsx for why that matters to the computer menu), and a native
       * navigation bar draws ABOVE react-native content whatever its z-index
       * says. Left as they are, the greeting and the filter would float on
       * top of the open drawer. The bar is transparent and has no title, so
       * with its two items withdrawn there is nothing left of it to see.
       */
      unstable_headerLeftItems: () =>
        navOpen
          ? []
          : [
              {
                type: "custom",
                hidesSharedBackground: true,
                element: (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                    {/* The nav, then the greeting. The machine switcher moved
                        inside the nav; this button keeps the machine's online
                        dot, which is the part of it you read at a glance. */}
                    <SideNavButton
                      onPress={() => setNavOpen(true)}
                      online={currentBinding?.online ?? false}
                      machineName={machineName}
                    />
                    <LiveWelcome
                      firstName={firstName}
                      busyCount={flattenNodes(working).length}
                      connection={connection}
                      onPress={() => router.push("/notifications")}
                    />
                  </View>
                ),
              },
            ],
      headerRight: () =>
        navOpen ? null : (
          <HomeHeaderControls
            userFilter={userFilter}
            rosterUsers={rosterUsers}
            setUserFilter={setUserFilter}
          />
        ),
    });
  }, [
    workspace,
    navigation,
    colors.bg,
    router,
    connection,
    navOpen,
    machineName,
    currentBinding?.online,
    userFilter,
    rosterUsers,
    setUserFilter,
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
  const [composerHeight, setComposerHeight] = useState(
    () => MIN_COMPOSER_HEIGHT + insets.bottom,
  );

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
    transform: [
      { translateY: -Math.max(0, keyboard.height.value - insets.bottom) },
    ],
  }));

  // On iPad the centred column moves up with the keyboard by padding, not by
  // the translate above: a translate by the full keyboard height would throw
  // a mid-screen field off the top.
  const centredKeyboardPad = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, keyboard.height.value - insets.bottom),
  }));

  // One composer, two homes: docked over the list on the phone and the narrow
  // iPad, centred in the pane on the wide iPad.
  const composer = (
    <HomeComposer
      value={draft}
      onChangeText={setDraft}
      onStart={() => void startSession()}
      starting={starting}
      projectLabel={projectPicker.label}
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
      bottomInset={wide ? 0 : insets.bottom}
    />
  );
  const folderRail = ready && projectPicker.options.length ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      // flexGrow 0: a ScrollView grows by default, and in the iPad rail's
      // column this one shared the height with the session list beneath it,
      // opening a blank band under the pills. The phone never saw it because
      // there the rail sits in an absolute 50pt box.
      style={{ height: 50, flexGrow: 0, flexShrink: 0, backgroundColor: "transparent" }}
      contentContainerStyle={{
        gap: 8,
        paddingHorizontal: space.lg,
        paddingTop: space.sm,
        paddingBottom: space.sm,
      }}
    >
      {/* "+" FIRST: start something new with a preset (create-sheet.tsx). */}
      <PressableScale
        onPress={() => {
          void Haptics.selectionAsync();
          setCreateOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Create something new"
        scale={0.96}
        style={{
          width: 34,
          minHeight: 34,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.pill,
          backgroundColor: colors.secondary,
        }}
      >
        <Icon ios="plus" android="add" size={15} weight="semibold" color={colors.text} />
      </PressableScale>
      {projectPicker.options.map((folder, index) => (
        <PressableScale
          key={`${folder.label}:${index}`}
          onPress={folder.onPress}
          // Hold a pill to arrange the rail: order, hide, add, create.
          onLongPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setRailSheetOpen(true);
          }}
          delayLongPress={350}
          accessibilityRole="button"
          accessibilityState={{ selected: folder.selected }}
          accessibilityLabel={`${folder.label} folder`}
          scale={0.96}
          // Selected is an OUTLINE and a shade lighter, not a white block.
          // A solid white pill in a row of grey ones was the loudest thing
          // on the screen, for a filter.
          style={{
            minHeight: 34,
            justifyContent: "center",
            paddingHorizontal: 14,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: folder.selected ? colors.borderStrong : "transparent",
            backgroundColor: folder.selected ? colors.card : colors.secondary,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              ...type.footnote,
              fontWeight: "600",
              color: folder.selected ? colors.text : colors.textSecondary,
            }}
          >
            {folder.label}
          </Text>
        </PressableScale>
      ))}
    </ScrollView>
  ) : null;

  return (
    <SessionUnreadContext.Provider value={unreadSessions}>
    <View style={{ flex: 1, backgroundColor: colors.bg, overflow: "hidden" }}>
    <Reanimated.View style={[{ flex: 1, backgroundColor: colors.bg, overflow: "hidden" }, navPageStyle]}>
      {!workspace && navOpen ? (
        <View style={{ position: "absolute", top: insets.top, left: 16, height: 44,
          zIndex: 110, flexDirection: "row", alignItems: "center", gap: 2 }}>
          <SideNavButton onPress={() => setNavOpen(false)}
            online={currentBinding?.online ?? false} machineName={machineName} />
          <LiveWelcome firstName={firstName} busyCount={flattenNodes(working).length}
            connection={connection} onPress={() => setNavOpen(false)} />
        </View>
      ) : null}
      {workspace ? (
        <View
          style={{
            position: "absolute",
            // Keep native header controls below the iPad window controls.
            top: wide ? 0 : 48,
            bottom: 0,
            left: railWidth,
            right: 0,
            display: home ? "none" : "flex",
          }}
        >
          {children}
        </View>
      ) : null}
      <View
        style={
          workspace
            ? {
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: wide ? railWidth : "100%",
                display: wide || home ? "flex" : "none",
                paddingTop: Math.max(insets.top, 56),
                borderRightWidth: wide ? 1 : 0,
                borderRightColor: colors.border,
              }
            : { flex: 1 }
        }
      >
        {workspace ? (
          <>
            {/* ONE GUTTER FOR THE RAIL: `space.md` here, on the tab strip,
                and on the section headers, with rows inset 8 inside it. The
                web's rail is `px-1.5` + `px-2`; this column had five
                different insets stacked in 320pt. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: space.md,
                gap: space.sm,
              }}
            >
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.xs }}>
                {/* Narrow enough that the rail IS the screen (Slide Over, a
                    split window): the nav has nowhere to live on screen, so
                    it becomes the phone's drawer and this button opens it.
                    Wide, the same rows sit in the rail's footer below and
                    there is nothing to open. */}
                {!wide ? (
                  <SideNavButton
                    onPress={() => setNavOpen(true)}
                    online={currentBinding?.online ?? false}
                    machineName={machineName}
                  />
                ) : null}
                {/* Flat, like the phone's bar item. The glass island it wore
                    read as a control in a row that already has two. */}
                <View style={{ height: 40, paddingHorizontal: 6, justifyContent: "center" }}>
                  <LiveWelcome
                    firstName={firstName}
                    busyCount={flattenNodes(working).length}
                    connection={connection}
                    onPress={() => navigateWorkspace("/notifications")}
                  />
                </View>
              </View>
              <HomeHeaderControls
                userFilter={userFilter}
                rosterUsers={rosterUsers}
                setUserFilter={setUserFilter}
              />
            </View>
            {/* No Chat/Schedules strip: Schedules lives in the Pages menu on
                the right, same as the phone, and a two-tab bar that was
                mostly "Chat" was a row spent on a choice nobody makes. */}
          </>
        ) : null}
        {workspace ? folderRail : null}
        <ScrollView
          style={{ flex: 1, position: "relative", zIndex: 0 }}
          /**
           * The list runs UNDER the composer, which floats over it. The padding
           * is the composer's measured height, so the last session can still be
           * scrolled clear of it — a fixed number would either strand the last
           * row under the glass or leave a dead band when the composer is one
           * line tall.
          */
          contentContainerStyle={{
            paddingTop:
              !workspace && folderRail
                ? insets.top + 44 + space.sm + 50
                : 0,
            paddingBottom:
              home && !wide ? composerHeight + space.md : insets.bottom + space.md,
          }}
          keyboardShouldPersistTaps="handled"
          // Scrolling the list puts the keyboard away. Reaching for the field is
          // an explicit act; scrolling past it is how you say you are done.
          keyboardDismissMode="on-drag"
          // The phone reserves its initial chrome above, then scrolls through
          // that space and under the translucent navigation bar. Automatic
          // adjustment kept the scroll viewport clipped below the bar, so
          // rows could never reach the material they were meant to drive.
          // Never, on both layouts. The rail already pads for the safe area
          // itself, and once the navigator's bar went transparent UIKit's
          // automatic inset added the bar's height on top of that: a blank
          // band between the folder pills and the first row on iPad.
          contentInsetAdjustmentBehavior="never"
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                refreshAuto();
                void Promise.all([probe(), load(true)]).finally(() =>
                  setPulling(false),
                );
              }}
              tintColor={colors.textMuted}
            />
          }
        >
          {/* NEW SESSION IS THE FIRST ROW of the list it adds to, as on the
              web (a 40px row with a dashed disc). It used to be an 18pt
              padded block above the list, outside the thing it acts on. */}
          {workspace ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New session"
              onPress={() => router.dismissTo("/")}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                height: 40,
                marginHorizontal: SESSION_ROW.inset,
                paddingHorizontal: SESSION_ROW.padding,
                borderRadius: radius.md,
                backgroundColor: pressed ? colors.cardPressed : "transparent",
              })}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: colors.borderStrong,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon
                  ios="plus"
                  android="add"
                  size={14}
                  color={colors.textSecondary}
                />
              </View>
              <Text style={{ ...type.subhead, color: colors.textSecondary }}>
                New session
              </Text>
            </Pressable>
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
          ) : readiness?.status === "connecting" ||
            readiness?.status === "waking" ? (
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
              <View
                style={{
                  alignItems: "center",
                  gap: space.xs,
                  paddingHorizontal: space.xl,
                }}
              >
                <Text style={{ ...type.callout, color: colors.textSecondary }}>
                  {readiness.status === "waking"
                    ? "Waking your computer…"
                    : `Connecting to ${machineName}…`}
                </Text>
                {readiness.status === "waking" ? (
                  <Text
                    style={{
                      ...type.footnote,
                      color: colors.textMuted,
                      textAlign: "center",
                    }}
                  >
                    It hibernated to save resources. This usually takes a
                    moment.
                  </Text>
                ) : null}
              </View>
              <SessionListSkeleton count={2} />
            </View>
          ) : readiness?.status === "agent-limit" ? (
            <EmptyState
              title="Too many agents running"
              detail={readiness.message}
              action={
                <PrimaryButton label="Try again" onPress={() => void probe()} />
              }
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
                  <PrimaryButton
                    label="Try again"
                    onPress={() => void probe()}
                  />
                  <DropdownMenu
                    title="Computer"
                    options={computerPicker.options}
                  >
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
              {visibleSessions.length === 0 && loading ? (
                // First fetch on this machine, nothing on screen to disturb.
                // Once `visibleSessions` is non-empty, RefreshControl (pull-to-refresh)
                // is the loading affordance instead — real rows must never be
                // swapped out for skeletons under someone's thumb.
                <SessionListSkeleton style={{ paddingTop: space.xl }} />
              ) : visibleSessions.length === 0 && !loading ? (
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
                  {/* The selected folder pill already names this list. */}
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
                            onArchive={
                              nodeBusy(node) ? undefined : archiveSession
                            }
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
                  <SectionHeader
                    label="Auto"
                    count={autoRows.length}
                    dotColor={colors.text}
                  />
                  <View style={{ gap: space.xs }}>
                    {/* One row per agent, as the web's Auto section: the
                        name, a count when there is more than one, the lead
                        finding, the worst severity and the newest time.
                        Tapping opens the agent's report page. */}
                    {groupHomeAutoFindings(autoRows).map((group) => (
                      <OverlapRow key={`agent:${group.agentId}`} id={`auto-agent:${group.agentId}`}>
                        <AutoReportRow
                          group={group}
                          animateEntry={animateEntry}
                          onOpen={() => {
                            void Haptics.selectionAsync();
                            const href = `/auto/${encodeURIComponent(group.agentId)}` as Href;
                            if (workspace) navigateWorkspace(href);
                            else router.push(href);
                          }}
                        />
                      </OverlapRow>
                    ))}
                  </View>
                </>
              ) : null}

              {/**
               * NO "RECENT" SECTION.
               *
               * Finished sessions used to get their own group at the foot of the
               * list. The web's mobile list does not carry one — resumable work
               * is reached from the composer's history rather than from the live
               * list — and on a phone the section was competing for the same
               * scroll as the sessions that are actually running.
               *
               * Work that shipped is still reachable: the Recently shipped feed
               * behind the bell lists it, and each entry opens its session. If
               * that stops being true, this section is the thing to bring back.
               */}
            </>
          )}
        </ScrollView>
        {/* THE NAV, PINNED TO THE FOOT OF THE RAIL, on iPad only.
            A 320pt column is already on screen, so sliding a second one over
            it would be ceremony; the rows simply live at the bottom of the one
            that is there, under a hairline, the way a sidebar footer does.

            IT SCROLLS ITSELF AND IT IS CAPPED. Five rows plus the machine is
            ~280pt, which is most of the column in a short window (a landscape
            split, a small stage). The cap keeps the session list the larger
            half and lets the nav scroll inside whatever it is given, rather
            than pushing the list off its own rail. */}
        {wide ? (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.border,
              maxHeight: Math.max(160, Math.round(windowHeight * 0.4)),
              paddingHorizontal: space.md - 4,
              paddingTop: space.xs,
              paddingBottom: insets.bottom + space.xs,
            }}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <SideNavPanel
                pathname={pathname}
                computerOptions={computerPicker.options}
                machineName={machineName}
                online={currentBinding?.online ?? false}
                navigate={(href) => navigateWorkspace(href as Href)}
                onShortcuts={
                  keyCommandsAvailable() ? () => setShortcutsOpen(true) : undefined
                }
              />
            </ScrollView>
          </View>
        ) : null}
      </View>
      <ShortcutsSheet visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <CreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        folders={projectPicker.folders}
        projectsRoot={projectPicker.projectsRoot}
        createFolder={projectPicker.createFolder}
        launch={launch}
      />
      <FolderRailSheet
        visible={railSheetOpen}
        onClose={() => setRailSheetOpen(false)}
        folders={projectPicker.folders}
        setOrder={projectPicker.setOrder}
        setHidden={projectPicker.setHidden}
        addFolder={projectPicker.addFolder}
        createFolder={projectPicker.createFolder}
        projectsRoot={projectPicker.projectsRoot}
      />
      {/* THE TOP FADE, under the bar and the folder rail: rows dissolve into
          the page as they pass beneath the chrome, mirroring the composer
          fade at the other end. Below the rail in z-order, above the list. */}
      {!workspace ? (
        <EdgeFade
          edge="top"
          color={colors.bg}
          style={{
            position: "absolute",
            zIndex: 90,
            top: 0,
            left: railWidth,
            right: 0,
            height: insets.top + 44 + space.sm + (folderRail ? 50 : 0) + TOP_FADE_HEIGHT,
          }}
        />
      ) : null}
      {!workspace && folderRail ? (
        <View
          style={{
            position: "absolute",
            zIndex: 100,
            elevation: 4,
            height: 50,
            top: insets.top + 44 + space.sm,
            left: 0,
            right: 0,
          }}
        >
          {folderRail}
        </View>
      ) : null}
      {/* THE EMPTY PANE IS THE COMPOSER, as on the web (App.tsx's empty
          stage renders the create composer full-height, centred). It was a
          28pt poster at 35% with the composer docked at the bottom of the
          same pane: two centres of attention and a dead band between them.
          The wordmark stays, small, above the field. The keyboard pads the
          column from below so the field rises with it instead of sitting
          under it. */}
      {ready && wide && home ? (
        <Reanimated.View
          style={[
            {
              position: "absolute",
              left: railWidth,
              right: 0,
              top: 0,
              bottom: 0,
              justifyContent: "center",
              alignItems: "center",
              paddingHorizontal: space.xl,
            },
            centredKeyboardPad,
          ]}
        >
          <View style={{ width: "100%", maxWidth: 560, gap: space.lg }}>
            <Text
              style={{
                ...type.headline,
                color: colors.textMuted,
                textAlign: "center",
              }}
            >
              omg.dev
            </Text>
            {composer}
          </View>
        </Reanimated.View>
      ) : null}

      {/* The composer only makes sense against a serving machine; readiness
          states own the whole screen until then.

          Absolute, so the list scrolls beneath the glass instead of stopping
          at a hard edge above it. `bottom: 0` is the parent's PADDING box, so
          the keyboard lift above still carries the composer up. */}
      {ready && !wide && (!workspace || home) ? (
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
              {
                position: "absolute",
                left: railWidth,
                right: 0,
                bottom: 0,
                height: composerHeight + COMPOSER_FADE_HEIGHT,
              },
              composerLift,
            ]}
          >
            <LinearGradient
              {...fadeStops(colors.bg)}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={{ flex: 1 }}
            />
          </Reanimated.View>
          <Reanimated.View
            style={[
              { position: "absolute", left: railWidth, right: 0, bottom: 0 },
              composerLift,
            ]}
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
            {composer}
          </Reanimated.View>
        </>
      ) : null}
    </Reanimated.View>
      {/* The phone's drawer, and the iPad's when its window is too narrow to
          keep the rail. Mounted last so it paints over the list; it draws
          nothing at all while closed. */}
      {!wide ? (
        <SideNavDrawer
          visible={navOpen}
          progress={navProgress}
          onClose={() => setNavOpen(false)}
          pathname={pathname}
          computerOptions={computerPicker.options}
          machineName={machineName}
          online={currentBinding?.online ?? false}
          onDismiss={() => setNavOpen(false)}
          navigate={(href) => {
            if (workspace) navigateWorkspace(href as Href);
            else router.push(href as Href);
          }}
          onShortcuts={
            keyCommandsAvailable() ? () => setShortcutsOpen(true) : undefined
          }
        />
      ) : null}
    </View>
    </SessionUnreadContext.Provider>
  );
}

export function IpadWorkspaceLayout({ children }: { children: ReactNode }) {
  return Platform.OS === "ios" && Platform.isPad ? (
    <SessionsScreen workspace>{children}</SessionsScreen>
  ) : (
    <>{children}</>
  );
}
