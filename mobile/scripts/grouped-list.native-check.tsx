/** @jsxImportSource ../../web/node_modules/react */
/**
 * The grouped-list geometry, pinned to what Apple actually draws.
 *
 * Every number here was measured off Settings on iOS 26 (iPhone 17 Pro, both
 * appearances) rather than guessed from a screenshot, and a screenshot of our
 * own screen cannot tell 20pt from 16pt once a recording has scaled it. So the
 * values are asserted at the component boundary, where they are exact.
 *
 * This is deliberately a style assertion, which is normally the wrong shape
 * for a test. It is right here because the style IS the behaviour: the whole
 * point of the change is that these specific numbers reach the view.
 */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
// Expo's async-require setup reads `__DEV__` at import time. Define it before
// anything in the module graph can touch it.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);

/** Flatten whatever style shape the component passes (object, array, or both). */
const flatten = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten))
    : style && typeof style === 'object' ? style as Record<string, unknown> : {};

let seen: Record<string, unknown>[] = [];
const Probe = ({ style, children }: { style?: unknown; children?: React.ReactNode }) => {
  seen.push(flatten(style));
  return <div>{children}</div>;
};
// The same mock surface home-composer.native-check.tsx uses: components.tsx
// pulls in symbols, reanimated, glass and the suggest sheets on import, and
// none of them can load outside a native runtime.
mock.module(resolve(import.meta.dir, '../node_modules/react-native/index.js'), () => ({
  View: Probe,
  ScrollView: Probe,
  Image: () => null,
  ActivityIndicator: () => null,
  Pressable: Probe,
  Switch: () => null,
  useWindowDimensions: () => ({ width: 402, height: 874 }),
  // theme.ts follows the device appearance; the check exercises both palettes
  // directly, so the hook only has to exist.
  useColorScheme: () => 'dark',
  StyleSheet: { hairlineWidth: 0.33, create: (s: unknown) => s },
}));
const chain: never = new Proxy({}, { get: () => () => chain }) as never;
mock.module(import.meta.resolve('react-native-reanimated'), () => ({
  default: { View: Probe, createAnimatedComponent: (C: unknown) => C },
  Easing: { linear: (x: unknown) => x, bezier: () => (x: unknown) => x },
  LinearTransition: chain,
  FadeIn: chain,
  ReduceMotion: { Always: 'always', Never: 'never' },
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withTiming: (x: unknown) => x,
  withRepeat: (x: unknown) => x,
}));
mock.module(import.meta.resolve('expo-symbols'), () => ({ SymbolView: () => null }));
const local = (file: string, exports: unknown) =>
  mock.module(resolve(import.meta.dir, `../src/omg/${file}`), () => exports as never);
local('sheet.tsx', { Sheet: () => null });
local('nav-gesture-context.ts', { useBlockNavGesture: () => undefined });
local('text.tsx', { Text: Probe, TextInput: () => null });
local('agent-icons.ts', { agentIcon: () => null });
local('model-provider-icons.ts', { modelProviderIcon: () => null });
local('glass.tsx', { GlassSurface: Probe, LIQUID_GLASS: false });
local('lucide.tsx', { LucideIcon: () => null });
local('usage.ts', {
  orderWindows: (x: unknown) => x,
  providerKindForAgent: () => undefined,
  detailsForKind: () => [],
});
local('menu.tsx', { DropdownMenu: Probe });
local('attach-menu.tsx', { AttachMenuButton: Probe });
local('agent-setup-sheet.tsx', { AgentSetupSheet: () => null });
// The starter rail's edge paint pulls in expo-linear-gradient, which
// imports `Platform` from the react-native module stubbed above.
local('edge-fade.tsx', { RailEdgeFades: () => null });
local('skill-suggest.tsx', { SkillSuggest: () => null });
local('session-mention-suggest.tsx', { SessionMentionSuggest: () => null });
local('swipe-row.ts', { useSwipeToCommit: () => ({}) });
local('session-activity.tsx', {
  useSessionActivity: () => ({ present: false }),
  SessionActivityTitle: () => null,
  SessionActivityField: () => null,
});
local('motion.tsx', {
  PressableScale: ({ style, children }: { style?: unknown; children?: React.ReactNode }) => {
    seen.push(flatten(typeof style === 'function' ? style({ pressed: false }) : style));
    return <div>{children}</div>;
  },
  useListItemMotion: () => ({}),
  useReduceMotionEnabled: () => true,
});

const { dark, light } = await import('../src/omg/palette');
const { Card, GROUPED_INSET, ICON_TILE, Row, SectionLabel, Separator } =
  await import('../src/components');

const render = (node: React.ReactNode) => {
  const ui = mount();
  seen = [];
  try {
    ui.render(<>{node}</>);
    return seen;
  } finally { ui.cleanup(); }
};

test('the grouped card uses the measured iOS surfaces and radius', () => {
  const styles = render(<Card><></></Card>);
  const card = styles.find(s => s.borderRadius !== undefined);
  expect(card).toBeTruthy();
  // Measured at 64px on a 3x screen.
  expect(card!.borderRadius).toBe(22);
  expect(card!.borderCurve).toBe('continuous');
  expect(card!.marginHorizontal).toBe(GROUPED_INSET);
});

test('the card sits wider than Apple, which is the deliberate part', () => {
  // Apple measures 16. Benny asked for more room on the sides, so this is 20
  // on purpose. If this fails because someone "restored the reference", that
  // is the conversation to have, not a number to quietly change.
  expect(GROUPED_INSET).toBe(20);
});

test('an icon-led row is 52pt and leads with a 14pt inset', () => {
  const styles = render(<Row icon={<></>}><></></Row>);
  const row = styles.find(s => s.minHeight !== undefined);
  expect(row!.minHeight).toBe(52);
  expect(row!.paddingLeft).toBe(14);
  expect(row!.paddingRight).toBe(16);
});

test('a row with no icon keeps the 44pt minimum and the wider text inset', () => {
  const styles = render(<Row><></></Row>);
  const row = styles.find(s => s.minHeight !== undefined);
  expect(row!.minHeight).toBe(44);
  expect(row!.paddingLeft).toBe(16);
});

test('the icon separator stops under the title, at the measured 56pt', () => {
  const styles = render(<Separator inset="icon" />);
  const line = styles.find(s => s.marginLeft !== undefined);
  // 14 leading + 29 tile + 12 gap. Apple measures 56pt from the card edge.
  expect(line!.marginLeft).toBe(14 + ICON_TILE + 12);
  expect(line!.marginLeft).toBe(55);
  expect(line!.height).toBe(1);
});

test('the section header is bold sentence case, tracking the card inset', () => {
  const styles = render(<SectionLabel>Computer</SectionLabel>);
  const label = styles.find(s => s.paddingHorizontal !== undefined);
  expect(label!.fontSize).toBe(22);
  expect(label!.fontWeight).toBe('700');
  // No uppercasing: iOS 26 headers are sentence case.
  expect(label!.textTransform).toBeUndefined();
  expect(label!.paddingHorizontal).toBe(GROUPED_INSET + 8);
});

test('the grouped surfaces are the measured values in both appearances', () => {
  expect(dark.groupedBackground).toBe('#000000');
  expect(dark.groupedCard).toBe('#1c1c1e');
  expect(dark.groupedSeparator).toBe('#38383b');
  expect(light.groupedBackground).toBe('#f2f2f7');
  expect(light.groupedCard).toBe('#ffffff');
  // The app's own card stays where it was tuned; this change must not move it.
  expect(dark.card).toBe('#242428');
});
