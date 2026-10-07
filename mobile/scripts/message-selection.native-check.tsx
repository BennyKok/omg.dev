/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
const View = ({ children }: any) => <div>{children}</div>;
const Pressable = ({ children, accessibilityLabel, disabled, onPress }: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
mock.module(resolve(import.meta.dir, '../node_modules/react-native/index.js'), () => ({ View, Pressable, ActionSheetIOS: { showActionSheetWithOptions: () => {} }, useWindowDimensions: () => ({ width: 390, height: 844 }), Modal: ({ visible, children }: any) => visible ? <section>{children}</section> : null }));
mock.module(import.meta.resolve('react-native-safe-area-context'), () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
const writes: string[] = [];
let failCopy = false;
mock.module(import.meta.resolve('expo-clipboard'), () => ({ setStringAsync: async (value: string) => { if (failCopy) throw new Error('unavailable'); writes.push(value); } }));
let select: (event: any) => void;
mock.module(resolve(import.meta.dir, '../src/omg/text.tsx'), () => ({
  Text: ({ children }: any) => <span>{children}</span>,
  TextInput: ({ value, onSelectionChange, editable }: any) => { select = onSelectionChange; return <textarea readOnly={!editable} value={value} />; },
}));
mock.module(resolve(import.meta.dir, '../src/omg/markdown.tsx'), () => ({ useBodyText: () => ({}) }));
const { light, type, space } = await import('../src/omg/palette');
mock.module(resolve(import.meta.dir, '../src/omg/theme.ts'), () => ({ useTheme: () => ({ colors: light, type, space }) }));
mock.module(import.meta.resolve('expo-constants'), () => ({ default: { platform: { ios: { buildNumber: null } } } }));
mock.module(import.meta.resolve('@expo/ui/community/menu'), () => ({ default: ({ children, actions, onPressAction }: any) => {
  const [open, setOpen] = React.useState(false);
  return <div><button aria-label="Message options" onClick={() => setOpen(true)}>{children}</button>{open ? actions.map((action: any) => <button key={action.id} aria-label={action.title} onClick={() => { setOpen(false); onPressAction({ nativeEvent: { event: action.id } }); }}>{action.title}</button>) : null}</div>;
} }));
const { MessageTextActions, ReplyTextActions } = await import('../src/omg/message-text-actions');

test('reply has no button; its hold menu offers Copy and Select text, and selection freezes a streaming reply', async () => {
  const ui = mount();
  const text = 'First paragraph.\n\n第二段 with code: `hello`';
  const click = (name: string) => ui.flush(() => (ui.query(`button[aria-label="${name}"]`) as HTMLButtonElement).click());
  const reply = (value: string) => <ReplyTextActions text={value}><span>Reply body</span></ReplyTextActions>;
  try {
    ui.render(reply(text));
    // The only control is the hold-menu trigger wrapping the reply itself.
    expect(ui.queryAll('button')).toHaveLength(1);
    expect(ui.text()).toBe('Reply body');
    click('Message options');
    expect(ui.queryAll('button').map(b => b.getAttribute('aria-label'))).toEqual(['Message options', 'Copy', 'Select text']);
    click('Copy');
    await ui.flushAsync(async () => {});
    expect(writes.at(-1)).toBe(text);
    expect(ui.text()).toContain('Copied');
    click('Message options');
    click('Select text');
    expect((ui.query('textarea') as HTMLTextAreaElement).readOnly).toBe(true);
    expect((ui.query('[aria-label="Copy selection"]') as HTMLButtonElement).disabled).toBe(true);
    ui.flush(() => select({ nativeEvent: { selection: { start: 6, end: 21 } } }));
    ui.render(reply(text + '\nStreaming update'));
    expect((ui.query('textarea') as HTMLTextAreaElement).value).toBe(text);
    click('Copy selection');
    await ui.flushAsync(async () => {});
    expect(writes.at(-1)).toBe(text.slice(6, 21));
    click('Copy all');
    await ui.flushAsync(async () => {});
    expect(writes.at(-1)).toBe(text);
    click('Done');
    expect(ui.query('textarea')).toBeNull();
    click('Message options');
    click('Select text');
    expect((ui.query('textarea') as HTMLTextAreaElement).value).toContain('Streaming update');
    failCopy = true;
    click('Copy all');
    await ui.flushAsync(async () => {});
    expect(ui.text()).toContain('Could not copy. Try again.');
  } finally { failCopy = false; ui.cleanup(); }
});

test('sent message menu preserves Copy and opens selection without an extra button', () => {
  const ui = mount();
  let copies = 0;
  const click = (name: string) => ui.flush(() => (ui.query(`button[aria-label="${name}"]`) as HTMLButtonElement).click());
  try {
    ui.render(<MessageTextActions text="Sent message" onCopy={() => { copies++; }}><span>Sent bubble</span></MessageTextActions>);
    expect(ui.query('[aria-label="Select text"]')).toBeNull();
    click('Message options');
    click('Copy');
    expect(copies).toBe(1);
    expect(ui.query('textarea')).toBeNull();
    click('Message options');
    click('Select text');
    expect((ui.query('textarea') as HTMLTextAreaElement).value).toBe('Sent message');
  } finally { ui.cleanup(); }
});

test('reporting shares the message hold menu and runs only when selected', () => {
  const ui = mount();
  let reports = 0;
  const click = (name: string) => ui.flush(() => (ui.query(`button[aria-label="${name}"]`) as HTMLButtonElement).click());
  try {
    ui.render(<ReplyTextActions text="Thread message" onReport={() => { reports++; }}><span>Thread message</span></ReplyTextActions>);
    expect(ui.text()).toBe('Thread message');
    expect(ui.queryAll('button')).toHaveLength(1);
    expect(reports).toBe(0);
    click('Message options');
    expect(ui.queryAll('button').map(b => b.getAttribute('aria-label'))).toEqual(['Message options', 'Copy', 'Select text', 'Report content']);
    expect(reports).toBe(0);
    click('Report content');
    expect(reports).toBe(1);
    expect(ui.query('textarea')).toBeNull();
  } finally { ui.cleanup(); }
});

test('attachment-only messages can be reported without empty copy or selection actions', () => {
  const ui = mount();
  let reports = 0;
  const click = (name: string) => ui.flush(() => (ui.query(`button[aria-label="${name}"]`) as HTMLButtonElement).click());
  try {
    ui.render(<ReplyTextActions text="" onReport={() => { reports++; }}><span>Attachment</span></ReplyTextActions>);
    click('Message options');
    expect(ui.queryAll('button').map(b => b.getAttribute('aria-label'))).toEqual(['Message options', 'Report content']);
    click('Report content');
    expect(reports).toBe(1);
  } finally { ui.cleanup(); }
});
