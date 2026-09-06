import { Platform } from "react-native";
import { SessionsScreen } from "../src/omg/sessions-screen";

export default function HomeRoute() {
  return Platform.OS === "ios" && Platform.isPad ? null : <SessionsScreen />;
}
