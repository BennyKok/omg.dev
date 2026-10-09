/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
const View = ({ children }: any) => <div>{children}</div>;
mock.module(import.meta.resolve('react-native'), () => ({ View }));
const local = (file: string, exports: any) => mock.module(resolve(import.meta.dir, '../src', file), () => exports);
local('components.tsx', { Card: View, GROUPED_INSET: 20, Row: View, SectionLabel: View, Separator: () => null, SettingsIcon: View, Icon: () => null });
local('omg/text.tsx', { Text: View });
local('omg/theme.ts', { useTheme: () => ({ colors: {}, space: { sm: 8 } }) });
local('omg/menu.tsx', { DropdownMenu: ({ title, options, children }: any) => {
 const [open, setOpen] = React.useState(false);
 return <div><button aria-label={title} onClick={() => setOpen(!open)}>{children}</button>
 {open && options.map((o: any) => <button key={o.label} disabled={o.disabled} aria-pressed={o.selected}
 onClick={() => { o.onPress(); setOpen(false); }}>{o.label}</button>)}</div>;
} });
let state = { mode: 'auto', language: 'auto', status: 'ready', hydrated: true, available: true };
let choices: any[][] = []; let retries = 0;
local('omg/native-transcription.ts', { useNativeTranscription: () => state,
 nativeTranscription: { setPreferences: (...args: any[]) => { choices.push(args); }, ensureLoaded: () => { retries++; } } });
const { NativeTranscriptionSettings } = await import('../src/omg/native-transcription-settings');
test('the native transcription picker keeps the selected mode and changes it', () => {
 const ui = mount(); choices = []; state = { mode: 'auto', language: 'auto', status: 'ready', hydrated: true, available: true };
 try {
  ui.render(<NativeTranscriptionSettings />);
  expect(ui.queryAll('button').length).toBe(2);
  ui.flush(() => ui.query<HTMLButtonElement>('[aria-label="Transcription"]')!.click());
  const options = ui.queryAll<HTMLButtonElement>('button[aria-pressed]');
  expect(options.map(o => o.textContent)).toEqual(['Auto','Cloud','Local']);
  expect(options[0]!.getAttribute('aria-pressed')).toBe('true');
  ui.flush(() => options[2]!.click());
  expect(choices).toEqual([['local']]);
 } finally { ui.cleanup(); }
});
test('language selection preserves the transcription mode', () => {
 const ui = mount(); choices = []; state = { ...state, mode: 'local' };
 try {
  ui.render(<NativeTranscriptionSettings />);
  ui.flush(() => ui.query<HTMLButtonElement>('[aria-label="Language"]')!.click());
  const cantonese = ui.queryAll<HTMLButtonElement>('button').find(b => b.textContent === 'Cantonese (cloud)')!;
  ui.flush(() => cantonese.click());
  expect(choices).toEqual([['local','yue']]);
 } finally { ui.cleanup(); }
});
test('preferences cannot change before storage hydration', () => {
 const ui = mount(); state = { ...state, hydrated: false };
 try {
  ui.render(<NativeTranscriptionSettings />);
  ui.flush(() => ui.query<HTMLButtonElement>('[aria-label="Transcription"]')!.click());
  expect(ui.queryAll<HTMLButtonElement>('button[aria-pressed]').every(b => b.disabled)).toBe(true);
 } finally { ui.cleanup(); }
});
