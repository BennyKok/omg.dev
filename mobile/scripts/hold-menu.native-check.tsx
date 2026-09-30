/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';

// Build 84 is the last TestFlight binary whose prebuilt expo-modules-core
// crashes under MenuView (RNHostView). It must get the action sheet instead.
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
const sheets: { options: string[]; pick: (index: number) => void }[] = [];
const Pressable = ({ children, onLongPress, testID }: any) => <button data-testid={testID} onClick={onLongPress}>{children}</button>;
mock.module(resolve(import.meta.dir, '../node_modules/react-native/index.js'), () => ({
  Pressable,
  ActionSheetIOS: { showActionSheetWithOptions: (config: any, pick: (index: number) => void) => sheets.push({ options: config.options, pick }) },
}));
mock.module(import.meta.resolve('expo-constants'), () => ({ default: { platform: { ios: { buildNumber: '84' } } } }));
let nativeMenus = 0;
mock.module(import.meta.resolve('@expo/ui/community/menu'), () => ({ default: ({ children }: any) => { nativeMenus++; return <div>{children}</div>; } }));
const { HoldMenu, NATIVE_HOLD_MENU_SAFE } = await import('../src/omg/hold-menu');

test('build 84 opens the actions as an action sheet on long press, with no MenuView', () => {
  expect(NATIVE_HOLD_MENU_SAFE).toBe(false);
  const ui = mount();
  const picked: string[] = [];
  try {
    ui.render(
      <HoldMenu actions={[{ id: 'copy', title: 'Copy' }, { title: 'Select text' }]} isDark={false} onAction={(id) => picked.push(id)} testID="menu">
        <span>Bubble</span>
      </HoldMenu>,
    );
    expect(nativeMenus).toBe(0);
    ui.flush(() => (ui.query('[data-testid="menu"]') as HTMLButtonElement).click());
    expect(sheets.at(-1)?.options).toEqual(['Copy', 'Select text', 'Cancel']);
    sheets.at(-1)!.pick(0);
    sheets.at(-1)!.pick(1);
    sheets.at(-1)!.pick(2);
    expect(picked).toEqual(['copy', 'Select text']);
  } finally { ui.cleanup(); }
});
