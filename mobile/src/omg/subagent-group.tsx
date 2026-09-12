import { useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { usePathname } from "expo-router";
import { AgentAvatar, Icon, SESSION_ROW, SessionCard } from "../components";
import { relativeTime } from "./format";
import { PressableScale } from "./motion";
import { sessionPreview } from "./session-preview";
import { flattenNodes, sessionStableId, type SessionNode } from "./session-tree";
import { Text } from "./text";
import { useTheme } from "./theme";

/** All descendants stay reachable, including children spawned by a subagent. */
export function SubagentGroup({ nodes, unreadSessions, onOpen }: {
  nodes: SessionNode[];
  unreadSessions: ReadonlySet<string>;
  onOpen: (id: string | null) => void;
}) {
  const { colors, type, radius } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();
  const sessions = useMemo(() => flattenNodes(nodes), [nodes]);
  const working = sessions.filter((session) => session.busy).length;
  const unread = sessions.filter((session) =>
    session.sessionId && unreadSessions.has(session.sessionId)).length;
  const label = `${sessions.length} subagent${sessions.length === 1 ? "" : "s"}`;

  return (
    <View style={{ marginLeft: SESSION_ROW.inset + SESSION_ROW.padding + SESSION_ROW.avatar + SESSION_ROW.gap,
      marginRight: SESSION_ROW.inset, marginBottom: 8 }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${label}${working ? `, ${working} working` : ""}${unread ? `, ${unread} unread` : ""}`}
        accessibilityHint={expanded ? "Hide subagent sessions" : "Show subagent sessions"}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8,
          minHeight: 44, borderRadius: radius.sm,
          backgroundColor: pressed ? colors.cardPressed : "transparent" })}
      >
        <View pointerEvents="none" style={{ flexDirection: "row", paddingVertical: 4 }}>
          {sessions.slice(0, 4).map((session, index) => (
            <View key={sessionStableId(session)} style={{ marginLeft: index ? -8 : 0,
              padding: 2, borderRadius: 16, backgroundColor: colors.bg, zIndex: 4 - index }}>
              <AgentAvatar agent={session.agent ?? session.agentLabel} size={24} busy={!!session.busy} plain />
            </View>
          ))}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ ...type.caption, color: colors.textSecondary }}>{label}</Text>
          {working ? <Text numberOfLines={1} style={{ ...type.caption, fontSize: 11, color: colors.textMuted }}>
            {working} working
          </Text> : null}
        </View>
        {unread ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary }} /> : null}
        <Icon ios={expanded ? "chevron.up" : "chevron.down"}
          android={expanded ? "expand_less" : "expand_more"} size={12} color={colors.textMuted} />
      </PressableScale>
      {expanded ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          {sessions.map((session) => (
            <SessionCard key={sessionStableId(session)} compact animateEntry={false}
              selected={Platform.OS === "ios" && Platform.isPad && pathname === `/session/${session.sessionId}`}
              title={session.title || session.lastUserText || "Untitled session"}
              subtitle={sessionPreview(session)}
              timestamp={relativeTime(session.lastActivityAt ?? session.startedAt)}
              agent={session.agent ?? session.agentLabel}
              busy={!!session.busy} blocked={session.status === "blocked"}
              unread={!!session.sessionId && unreadSessions.has(session.sessionId)}
              onPress={() => onOpen(session.sessionId)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
