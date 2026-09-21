/** Simulator-only full-app entry. All data stays inside the demo transport. */
import { setDemoMode } from "../src/omg/demo";
// This sets the in-memory flag synchronously. Register the root immediately;
// waiting for AsyncStorage before registration crashes a fast native launch.
void setDemoMode(true);
require("expo-router/entry");
