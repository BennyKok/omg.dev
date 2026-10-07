/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from '../../web/src/test-support/render';
import { afterEach, expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';

mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
function View({ children, testID, pointerEvents, ref }: any) {
  React.useImperativeHandle(ref, () => ({ measureInWindow: (callback: Function) => callback(0, 0, 80, 80) }), []);
  return <div data-testid={testID} data-pointer-events={pointerEvents}>{children}</div>;
}
mock.module('react-native', () => ({
  View, Pressable: View,
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
  AppState: { addEventListener: () => ({ remove() {} }) },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
mock.module('react-native-reanimated', () => ({
  default: { View },
  useSharedValue: (value: number) => React.useMemo(() => ({ value }), []),
  useAnimatedStyle: () => ({}), useReducedMotion: () => false, withTiming: (value: number) => value,
}));
mock.module('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 48, bottom: 34, left: 0, right: 0 }) }));
mock.module('expo-router', () => ({ router: { push() {} }, usePathname: () => '/' }));
mock.module(resolve(import.meta.dir, '../src/omg/boxy.tsx'), () => ({ Boxy: () => <span>Boxy</span> }));
mock.module(resolve(import.meta.dir, '../src/omg/text.tsx'), () => ({ Text: ({ children }: any) => <span>{children}</span> }));
mock.module(resolve(import.meta.dir, '../src/omg/theme.ts'), () => ({ useTheme: () => ({ colors: {}, type: {}, isDark: false }) }));
mock.module(resolve(import.meta.dir, '../src/omg/config.ts'), () => ({ CLOUD_BINDING_ID: 'cloud' }));
mock.module(resolve(import.meta.dir, '../src/omg/session-cache-store.ts'), () => ({ sessionCache: { read: () => [] } }));
let readiness = 'ready';
let socket = 'live';
const listeners = new Set<(state: { status: string }) => void>();
const client = { live: { subscribeConnection: (listener: (state: { status: string }) => void) => {
  listeners.add(listener); listener({ status: socket }); return () => { listeners.delete(listener); };
} } };
mock.module(resolve(import.meta.dir, '../src/omg/provider.tsx'), () => ({ useOmg: () => ({
  authStatus: 'signed-in', bindingId: 'machine-a', readiness: { status: readiness }, client, probe: async () => {},
}) }));
const { ConnectionOverlay } = await import('../src/omg/connection-overlay');
let ui: Mounted;
const actualNow = Date.now;
let now = actualNow();
afterEach(() => { ui?.cleanup(); Date.now = actualNow; readiness = 'ready'; socket = 'live'; });
const card = () => ui.query('[data-testid="connection-overlay"]');
function emit(status: string) { socket = status; for (const listener of listeners) listener({ status }); }
function start() { now = actualNow(); Date.now = () => now; ui = mount(); ui.render(<ConnectionOverlay />); }

test('a brief offline event does not mount a blocking native dialog', () => {
  start();
  ui.flush(() => emit('offline'));
  expect(card()).toBeNull();
  ui.flush(() => emit('live'));
  expect(card()).toBeNull();
});

test('the native dialog closes on socket recovery while bootstrap still has its old error', async () => {
  start();
  readiness = 'unavailable';
  ui.flush(() => emit('offline'));
  now += 21_000;
  ui.render(<ConnectionOverlay />);
  expect(card()).not.toBeNull();
  ui.flush(() => emit('live'));
  expect(ui.text()).toContain('Connected');
  expect(card()?.getAttribute('data-pointer-events')).toBe('none');
  await ui.flushAsync(() => new Promise(resolve => setTimeout(resolve, 1_350)));
  expect(card()).toBeNull();
  expect(ui.text()).not.toContain('Connected');
  expect(listeners.size).toBe(1);
});
