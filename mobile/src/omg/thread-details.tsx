import type { ReactNode } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../components";
import { authorHue } from "../../../packages/protocol/src/threads";
import { agentIcon } from "./agent-icons";
import { DropdownMenu, type MenuOption } from "./menu";
import { Text } from "./text";
import { useTheme } from "./theme";
import type { ThreadDetail } from "./threads";

type Participant = ThreadDetail["participants"][number];

const nameOf = (row: Participant) => row.display.name?.trim() || row.display.fallback;
const hueOf = (row: Participant) => authorHue({ kind: "human", participantId: row.id, name: nameOf(row) });

function Initial({ row, size }: { row: Participant; size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `hsl(${hueOf(row)}, 45%, 45%)`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size / 2.3 }}>{nameOf(row).slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/**
 * A thread's face in the bar, where a session shows its agent: the first two
 * people, overlapped, as a group chat does. One person is one disc.
 */
export function GroupAvatar({ authors, size = 32 }: { authors: Participant[]; size?: number }) {
  const { colors } = useTheme();
  const shown = authors.slice(0, 2);
  if (shown.length < 2) {
    return shown[0] ? (
      <Initial row={shown[0]} size={size} />
    ) : (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.secondary }} />
    );
  }
  const small = Math.round(size * 0.64);
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: "absolute", left: 0, top: 0 }}>
        <Initial row={shown[0]} size={small} />
      </View>
      <View style={{ position: "absolute", right: 0, bottom: 0, borderRadius: small / 2, borderWidth: 2, borderColor: colors.bg }}>
        <Initial row={shown[1]} size={small - 4} />
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors, type, space, radius } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...type.footnote, color: colors.textMuted, paddingHorizontal: space.sm }}>{title}</Text>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.xl, overflow: "hidden" }}>{children}</View>
    </View>
  );
}

function Row({ start, title, subtitle, end, onPress, testID }: {
  start?: ReactNode;
  title: string;
  subtitle?: string | null;
  end?: ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const { colors, type, space } = useTheme();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: 12 }}>
      {start}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ ...type.body, color: colors.text }}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={{ ...type.footnote, color: colors.textMuted }}>{subtitle}</Text> : null}
      </View>
      {end}
    </View>
  );
  return onPress ? (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? colors.cardPressed : "transparent" })}>
      {body}
    </Pressable>
  ) : (
    <View testID={testID}>{body}</View>
  );
}

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * THREAD DETAILS: who is in it, where its tasks run, what it started. The
 * group-chat info page, reached from the title or the overflow menu.
 */
export function ThreadDetailsSheet({
  detail,
  projectOptions,
  onClose,
  onOpenTask,
  onRename,
  onArchive,
}: {
  detail: ThreadDetail | null;
  projectOptions: MenuOption[];
  onClose: () => void;
  onOpenTask: (sessionId: string) => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  const { colors, type, space } = useTheme();
  const insets = useSafeAreaInsets();
  const people = (detail?.participants ?? []).filter((row) => row.kind === "human");
  const project = detail?.thread.project ?? null;
  const tasks = detail?.tasks ?? [];
  return (
    <View testID="thread-details" style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Text style={{ ...type.headline, flex: 1, color: colors.text }}>Details</Text>
        <Pressable testID="thread-details-close" accessibilityRole="button" accessibilityLabel="Close details" onPress={onClose} hitSlop={10}>
          <Icon ios="xmark" android="close" size={16} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: insets.bottom + space.xl }}>
        <View style={{ alignItems: "center", gap: space.sm }}>
          <GroupAvatar authors={people} size={64} />
          <Text style={{ fontSize: 22, lineHeight: 28, fontWeight: "700", color: colors.text, textAlign: "center" }}>
            {detail?.thread.title ?? "Thread"}
          </Text>
          <Pressable accessibilityRole="button" onPress={onRename} hitSlop={8}>
            <Text style={{ ...type.subhead, color: colors.primary }}>Rename</Text>
          </Pressable>
        </View>

        <Section title={`Members · ${people.length + 1}`}>
          {people.map((row) => (
            <Row
              key={row.id}
              start={<Initial row={row} size={32} />}
              title={row.id === detail?.me ? `${nameOf(row)} (you)` : nameOf(row)}
              subtitle={row.role === "owner" ? "Owner" : "Member"}
            />
          ))}
          <Row
            testID="thread-details-omg"
            start={<Image source={agentIcon("omg")} style={{ width: 32, height: 32, borderRadius: 8 }} accessible={false} />}
            title="omg"
            subtitle="Answers, or starts a task, when someone writes @omg"
          />
        </Section>

        <Section title="Project">
          <DropdownMenu title="Tasks run in" options={projectOptions}>
            <Row
              testID="thread-details-project"
              start={<Icon ios="folder" android="folder" size={20} color={colors.textSecondary} />}
              title={project?.name ?? "No project"}
              subtitle="Where tasks from this thread run"
              end={<Text style={{ ...type.subhead, color: colors.primary }}>Change</Text>}
            />
          </DropdownMenu>
        </Section>

        {tasks.length ? (
          <Section title={`Tasks · ${tasks.length}`}>
            {tasks.map((task) => (
              <Row
                key={task.sessionId}
                title={task.title || "Task"}
                subtitle={[task.project, task.busy ? "Working" : task.ended ? "Ended" : "Waiting"].filter(Boolean).join(" · ")}
                end={<Icon ios="chevron.right" android="chevron_right" size={13} color={colors.textMuted} />}
                onPress={() => onOpenTask(task.sessionId)}
              />
            ))}
          </Section>
        ) : null}

        {detail ? (
          <Text style={{ ...type.footnote, color: colors.textMuted, textAlign: "center" }}>
            Started {DATE.format(detail.thread.createdAt)}
          </Text>
        ) : null}

        <Pressable
          testID="thread-details-archive"
          accessibilityRole="button"
          onPress={onArchive}
          style={({ pressed }) => ({ alignItems: "center", paddingVertical: 14, borderRadius: 14, backgroundColor: pressed ? colors.cardPressed : colors.card })}
        >
          <Text style={{ ...type.body, color: colors.danger }}>Archive thread</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
