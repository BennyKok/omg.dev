/**
 * Two tabs for v1: the sessions you care about, and settings.
 *
 * NativeTabs is the SDK 57 API that renders a real UIKit UITabBar rather than a
 * JS imitation, which is what makes the bar blur, shrink on scroll and match
 * every other iOS app for free. `minimizeBehavior` is the iOS 26 shrink-on-
 * scroll behaviour.
 *
 * The Sessions icon is a stack, not `bolt.horizontal.circle.fill`. That symbol
 * renders as a squiggle inside a filled disc, which at tab-bar size reads as
 * the Messenger logo rather than as anything to do with sessions.
 */

import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useTheme } from "../../src/omg/theme";

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={colors.primary}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="rectangle.stack.fill" md="dynamic_feed" />
        <NativeTabs.Trigger.Label>Sessions</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape.fill" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
