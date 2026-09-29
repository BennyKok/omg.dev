import { View } from "react-native";
import { SessionCard } from "../components";
import { TASK_STATE_LABEL, type TaskCardState } from "./thread-tasks";

/**
 * A TASK IN A THREAD, drawn as an attachment: the session list's own row in
 * its compact form (the one a parent's subagents use), not a card of its
 * own. The agent's mark, the title, and "Needs you · web" under it; working
 * and waiting show the way they do on Home.
 *
 * It used to be a 90pt card with a coloured state line, a short id and the
 * title in headline type, and in a reply thread it outweighed the replies
 * around it (2026-09-29).
 */
export function TaskCard({
  sessionId,
  title,
  project,
  agent,
  state,
  onOpen,
}: {
  sessionId: string;
  title: string;
  project: string | null;
  agent?: string | null;
  state: TaskCardState;
  onOpen?: () => void;
}) {
  const label = TASK_STATE_LABEL[state];
  return (
    <View testID={`task-card-${sessionId.slice(0, 8)}`} style={{ alignSelf: "stretch" }}>
      <SessionCard
        compact
        sessionId={sessionId}
        title={title}
        subtitle={project ? `${label} · ${project}` : label}
        agent={agent}
        busy={state === "working"}
        blocked={state === "needs-you"}
        ended={state === "ended"}
        animateEntry={false}
        accessibilityHint={`Task ${label}. Opens the session.`}
        onPress={() => onOpen?.()}
      />
    </View>
  );
}
