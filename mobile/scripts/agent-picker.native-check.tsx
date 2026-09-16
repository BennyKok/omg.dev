/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';

mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
mock.module(import.meta.resolve('@react-native-async-storage/async-storage'), () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}));
mock.module(resolve(import.meta.dir, '../src/omg/config.ts'), () => ({ STORAGE_KEYS: { composerSetup: 'setup' } }));
mock.module(resolve(import.meta.dir, '../src/omg/agent-icons.ts'), () => ({
  agentIcon: () => undefined, agentLabel: (key: string) => key,
}));
const agents = [{ key: 'aisdk', label: 'Claude' }, { key: 'codex-aisdk', label: 'Codex' }];
let bindingId = 'machine-a';
const client = { transport: { request: async (path: string) => path.endsWith('/accounts') ? {
  accounts: [
    { id: 'account-a', number: 1, connected: true, profile: { label: 'private@example.com' } },
    { id: 'account-b', number: 2, connected: true, needsReconnect: true },
  ],
} : { models: [
  { key: 'aisdk', defaultModel: 'opus', models: ['opus', 'sonnet'], thinkingLevels: ['low', 'medium', 'high'] },
  { key: 'codex-aisdk', defaultModel: 'gpt-6-astra', models: ['gpt-6-astra', 'gpt-5.3-codex'], thinkingLevels: ['low', 'high'] },
] } } };
mock.module(resolve(import.meta.dir, '../src/omg/provider.tsx'), () => ({
  useOmg: () => ({ agents, bindingId, client }),
}));
const { useAgentPicker } = await import('../src/omg/session-options');

test('profiles default to Auto, route only Claude, and reset on machine change', async () => {
  const ui = mount();
  let picker!: ReturnType<typeof useAgentPicker>;
  function Fixture() { picker = useAgentPicker(); return null; }
  try {
    await ui.flushAsync(async () => { ui.render(<Fixture />); });
    expect(picker.claudeAccountId).toBeUndefined();
    expect(picker.accountOptions.map(o => o.label)).toEqual(['Auto', '1', '2']);
    expect(picker.accountOptions[2]?.disabled).toBe(true);
    ui.flush(() => picker.accountOptions[1]?.onPress?.());
    expect(picker.claudeAccountId).toBe('account-a');
    ui.flush(() => picker.toggleFast?.());
    ui.flush(() => picker.options[0]?.onPress?.());
    expect(picker.fastMode).toBe(true); // Holding the selected agent must not reset it.
    ui.flush(() => picker.options[1]?.onPress?.());
    expect(picker.claudeAccountId).toBeUndefined();
    expect(picker.fastMode).toBe(false);
    expect(picker.toggleFast).toBeDefined();
    ui.flush(() => picker.toggleFast?.());
    ui.flush(() => picker.modelOptions[1]?.onPress?.());
    expect(picker.fastMode).toBe(false);
    expect(picker.toggleFast).toBeUndefined();
    ui.flush(() => picker.options[0]?.onPress?.());
    expect(picker.claudeAccountId).toBe('account-a');
    ui.flush(() => picker.accountOptions[0]?.onPress?.());
    expect(picker.claudeAccountId).toBeUndefined();
    ui.flush(() => picker.accountOptions[1]?.onPress?.());
    await ui.flushAsync(async () => { bindingId = 'machine-b'; ui.render(<Fixture />); });
    expect(picker.claudeAccountId).toBeUndefined();
    expect(picker.fastMode).toBe(false);
  } finally { ui.cleanup(); }
});
