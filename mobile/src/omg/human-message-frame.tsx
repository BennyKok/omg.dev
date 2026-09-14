import { useState, type ReactNode } from "react";
import { Image, View } from "react-native";
import type { ConversationParticipant } from "../../../src/conversation-contract";
import { Text } from "./text";
import { useTheme } from "./theme";

export function HumanMessageFrame({ sender, firstOfRun = true, lastOfRun = true, children }: {
  sender: ConversationParticipant | null;
  firstOfRun?: boolean;
  lastOfRun?: boolean;
  children: ReactNode;
}) {
  const { colors, type } = useTheme();
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  if (!sender) return <>{children}</>;
  const name = sender.display.name?.trim() || sender.display.fallback || "Member";
  const avatar = sender.display.avatar;
  return (
    <View accessibilityLabel={`Message from ${name}`} style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
      <View style={{ width: 24, flexShrink: 0, paddingBottom: 2 }}>
        {lastOfRun ? (
          <View accessibilityLabel={name} style={{ width: 24, height: 24, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colors.card }}>
            <Text style={{ ...type.caption, fontSize: 11, color: colors.textSecondary }}>{name.slice(0, 1).toUpperCase()}</Text>
            {avatar && avatar !== failedAvatar ? <Image source={{ uri: avatar }} onError={() => setFailedAvatar(avatar)} style={{ position: "absolute", width: 24, height: 24 }} /> : null}
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        {firstOfRun ? <Text style={{ ...type.caption, fontSize: 11, color: colors.textMuted }}>{name}</Text> : null}
        {children}
      </View>
    </View>
  );
}
