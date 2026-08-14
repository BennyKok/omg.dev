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
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
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
} from "../src/components";
import { useAttachments } from "../src/omg/attachments";
import { useComputerPicker } from "../src/omg/computer-picker";
import { useDictation } from "../src/omg/dictation";
import { LucideIcon } from "../src/omg/lucide";
import { DropdownMenu } from "../src/omg/menu";
import { useAgentPicker, useProjectPicker } from "../src/omg/session-options";
import { useOmg } from "../src/omg/provider";
import { useToast } from "../src/omg/toast";
import { SessionListSkeleton } from "../src/omg/skeleton";
import { useTheme } from "../src/omg/theme";
import { bindingLabel } from "../src/omg/format";
import { CLOUD_BINDING_ID } from "../src/omg/config";

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
function LiveWelcome({ firstName, busyCount }: { firstName: string; busyCount: number }) {
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
    <Text
      numberOfLines={1}
      style={{ ...type.headline, color: colors.text, maxWidth: 210 }}
    >
      {busyCount > 0 && showActivity ? activity : welcome}
    </Text>
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
  const { client, readiness, probe, bindingId, bindings, user } = useOmg();
  const computerPicker = useComputerPicker();
  // No session exists yet, so these upload to the pre-session endpoint and
  // ride along in the prompt that creates one.
  const attachments = useAttachments(null);
  const agentPicker = useAgentPicker();
  const projectPicker = useProjectPicker();

  const [sessions, setSessions] = useState<OmgSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (error) toast.show(error, { intent: "error" });
  }, [error, toast]);
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
    client ? (path, init) => client.transport.fetch(path, init) : null,
    (text) => setDraft((current) => (current ? `${current} ${text}` : text)),
  );

  const ready = readiness?.status === "ready";

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
        setSessions(await client.listSessions());
        setError(null);
      } catch (e) {
        // A failed background poll keeps the list it already has. Only a
        // refresh someone ASKED for is worth an error banner.
        if (!quiet) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [client, ready],
  );

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

  const currentBinding = useMemo(
    () => bindings.find((b) => b.id === bindingId) ?? null,
    [bindings, bindingId],
  );

  const machineName = currentBinding
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

  const working = sessions.filter((s) => s.busy);
  const idle = sessions.filter((s) => !s.busy);

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
  const startSession = useCallback(async () => {
    const prompt = attachments.compose(draft.trim());
    if (!prompt || !client || starting) return;
    setStarting(true);
    try {
      const res = await client.transport.request<{ sessionId?: string }>("/api/sessions/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          agent: agentPicker.agent,
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
  }, [attachments, client, agentPicker.agent, projectPicker.cwd, draft, starting, load, router]);

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
          element: <LiveWelcome firstName={firstName} busyCount={working.length} />,
        },
      ],
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
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
  const [composerHeight, setComposerHeight] = useState(0);

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
            refreshing={loading}
            onRefresh={() => {
              void probe();
              void load();
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
        ) : readiness?.status === "waking" ? (
          // Skeleton cards, not a spinner: the sessions that were here before
          // hibernation are coming back, not being discovered fresh, and the
          // shape of the list underneath the copy says so without a word
          // changing. See probe() in ../src/omg/provider.tsx for why this
          // state exists at all.
          <View style={{ gap: space.lg, paddingTop: space.xl }}>
            <View style={{ alignItems: "center", gap: space.xs, paddingHorizontal: space.xl }}>
              <Text style={{ ...type.callout, color: colors.textSecondary }}>Waking your computer…</Text>
              <Text style={{ ...type.footnote, color: colors.textMuted, textAlign: "center" }}>
                It hibernated to save resources. This usually takes a moment.
              </Text>
            </View>
            <SessionListSkeleton count={2} />
          </View>
        ) : readiness?.status === "agent-limit" ? (
          <EmptyState
            title="Too many agents running"
            detail={readiness.message}
            action={<PrimaryButton label="Try again" onPress={() => void probe()} />}
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

            {working.length > 0 ? (
              <>
                {/* Amber, not brand orange: the web's Working header carries
                    the same `bg-warning` as the busy row dot. */}
                <SectionHeader label="Working" count={working.length} dotColor={colors.warning} />
                {/* Each session is its own card now, so the rows need air
                    between them — see SessionCard. */}
                <View style={{ gap: space.sm }}>
                  {working.map((s, i) => (
                    <SessionCard
                      key={s.sessionId ?? i}
                      title={s.title || s.lastUserText || "Untitled session"}
                      subtitle={s.title ? s.lastUserText : null}
                      agent={s.agent ?? s.agentLabel}
                      busy
                      blocked={s.status === "blocked"}
                      onPress={() => openSession(s.sessionId)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {idle.length > 0 ? (
              <>
                <SectionHeader
                  label="Idle"
                  count={idle.length}
                  dotColor={colors.success}
                />
                <View style={{ gap: space.sm }}>
                  {idle.map((s, i) => (
                    <SessionCard
                      key={s.sessionId ?? i}
                      title={s.title || s.lastUserText || "Untitled session"}
                      subtitle={s.title ? s.lastUserText : null}
                      agent={s.agent ?? s.agentLabel}
                      blocked={s.status === "blocked"}
                      onPress={() => openSession(s.sessionId)}
                      onArchive={() => archiveSession(s.sessionId)}
                    />
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
        <Reanimated.View
          style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, composerLift]}
          onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
        >
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
          attachments={attachments}
          dictation={dictation}
          bottomInset={insets.bottom}
        />
        </Reanimated.View>
      ) : null}
    </Reanimated.View>
  );
}
