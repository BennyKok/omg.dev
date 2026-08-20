import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { BotEditScreen } from "../../../src/omg/bot-edit-screen";
import { useBots } from "../../../src/omg/bots";
import { useTheme } from "../../../src/omg/theme";

export default function EditBotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { bots, loading } = useBots();
  const bot = bots.find((b) => b.id === id) ?? null;

  // Covers the brief window before the roster's own fetch resolves. A stale
  // or missing id falls back to the same spinner rather than a full-page
  // form for a bot that does not exist — there is nothing truthful to show
  // instead, and the roster's own fetch is what will (or will not) resolve
  // it.
  if (!bot) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        {loading ? <ActivityIndicator color={colors.textMuted} /> : null}
      </View>
    );
  }

  return <BotEditScreen bot={bot} />;
}
