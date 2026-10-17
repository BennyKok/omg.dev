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
// The launch screen's look is its own check; here it only has to show what it
// was given and report when its exit has played.
mock.module(resolve(import.meta.dir, '../src/omg/launch.tsx'), () => ({
  LaunchScreen: ({ label, detail, actions, done, onFinished, testID }: any) => {
    React.useEffect(() => { if (done) setTimeout(() => onFinished?.(), 50); }, [done]);
    return <div data-testid={testID} data-done={done ? 'true' : 'false'}><span>{label}</span>{detail ? <span>{detail}</span> : null}{actions}</div>;
  },
}));
mock.module(resolve(import.meta.dir, '../src/omg/text.tsx'), () => ({ Text: ({ children }: any) => <span>{children}</span> }));
mock.module(resolve(import.meta.dir, '../src/omg/theme.ts'), () => ({ useTheme: () => ({ colors: {}, type: {}, isDark: false }) }));
mock.module(resolve(import.meta.dir, '../src/omg/config.ts'), () => ({ CLOUD_BINDING_ID: 'cloud' }));
mock.module(resolve(import.meta.dir, '../src/omg/session-cache-store.ts'), () => ({ sessionCache: { read: () => [] } }));
let readiness = 'ready';
let socket = 'live';
const listeners = new Set<(state: { status: string }) => void>();
const client = { live: { reconnectNow() {}, subscribeConnection: (listener: (state: { status: string }) => void) => {
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
const page = () => ui.query('[data-testid="connection-page"]');
function emit(status: string) { socket = status; for (const listener of listeners) listener({ status }); }
function start() { now = actualNow(); Date.now = () => now; ui = mount(); ui.render(<ConnectionOverlay />); }

test('a short drop after the computer was ready draws nothing over the screen in use', () => {
  start();
  ui.flush(() => emit('reconnecting'));
  now += 5_000;
  ui.render(<ConnectionOverlay />);
  expect(page()).toBeNull();
  ui.flush(() => emit('live'));
  expect(page()).toBeNull();
});

test('a long drop takes the full page, and recovery plays its exit and removes it', async () => {
  start();
  ui.flush(() => emit('reconnecting'));
  now += 61_000;
  ui.render(<ConnectionOverlay />);
  expect(page()?.getAttribute('data-done')).toBe('false');
  expect(ui.text()).toContain('Reconnecting to your computer');
  expect(ui.text()).toContain('Try again');
  ui.flush(() => emit('live'));
  expect(page()?.getAttribute('data-done')).toBe('true');
  await ui.flushAsync(() => new Promise(resolve => setTimeout(resolve, 120)));
  expect(page()).toBeNull();
  expect(listeners.size).toBe(1);
});

test('a settled failure names itself and offers Try again', () => {
  start();
  readiness = 'unavailable';
  ui.flush(() => emit('offline'));
  now += 21_000;
  ui.render(<ConnectionOverlay />);
  expect(ui.text()).toContain('Your computer is not available');
  expect(ui.text()).toContain('Try again');
  expect(ui.text()).toContain('Choose another computer');
});

test('the overlay stays off while the launch screen owns the first connect', () => {
  now = actualNow(); Date.now = () => now; ui = mount();
  readiness = 'unavailable';
  socket = 'offline';
  now += 30_000;
  ui.render(<ConnectionOverlay enabled={false} />);
  expect(page()).toBeNull();
});
