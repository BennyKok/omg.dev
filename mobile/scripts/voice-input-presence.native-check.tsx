/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
let reduced = false;
mock.module(import.meta.resolve('react-native'), () => ({
  AccessibilityInfo: { isReduceMotionEnabled: async () => reduced, addEventListener: () => ({ remove() {} }) },
  Pressable: () => null,
}));
mock.module(import.meta.resolve('react-native-reanimated'), () => ({
  default: { View: () => null }, useReducedMotion: () => reduced,
  useAnimatedStyle: (fn: () => unknown) => fn(), useSharedValue: (value: unknown) => ({ value }), withSpring: (value: unknown) => value,
  Easing: { bezier: () => () => 0 },
  FadeInDown: {}, LinearTransition: {}, ReduceMotion: {},
}));
const { useVoiceInputPresence } = await import('../src/omg/motion');
function Composer({ active }: { active: boolean }) {
  return <div>{useVoiceInputPresence(active) ? 'expanded' : 'compact'}</div>;
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 190));
test('the composer remains open during the recorder exit', async () => {
  reduced = false; const ui = mount();
  try {
    ui.render(<Composer active />);
    ui.render(<Composer active={false} />);
    expect(ui.text()).toBe('expanded');
    await ui.flushAsync(settle);
    expect(ui.text()).toBe('compact');
  } finally { ui.cleanup(); }
});
test('a new take cancels an unfinished exit', async () => {
  reduced = false; const ui = mount();
  try {
    ui.render(<Composer active />);
    ui.render(<Composer active={false} />);
    ui.render(<Composer active />);
    await ui.flushAsync(settle);
    expect(ui.text()).toBe('expanded');
  } finally { ui.cleanup(); }
});
test('Reduce Motion closes the composer immediately', async () => {
  reduced = true; const ui = mount();
  try {
    ui.render(<Composer active />);
    await ui.flushAsync();
    ui.render(<Composer active={false} />);
    expect(ui.text()).toBe('compact');
  } finally { ui.cleanup(); }
});
