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
// Provider marks are PNG requires; bun cannot load those, so name the mark instead.
mock.module(resolve(import.meta.dir, '../src/omg/model-provider-icons.ts'), () => ({
  modelProviderIcon: (provider?: string | null) => provider ? { uri: `provider-${provider}` } : null,
}));
const agents = [{ key: 'aisdk', label: 'Claude' }, { key: 'codex-aisdk', label: 'Codex' }, { key: 'omg', label: 'omg agent' }];
let bindingId = 'machine-a';
/**
 * The box's own state, which the picker's two fetches are gated on. A test
 * that leaves this "ready" is testing the awake case only; the bug this file
 * now covers is the ASLEEP one.
 */
let readiness: { status: string } | null = { status: 'ready' };
/** Fail the next N requests, to stand in for a box that is still waking. */
let failures = 0;
let requests = 0;
const client = { transport: { request: async (path: string) => { requests++; if (failures > 0) { failures--; throw new Error('sandbox waking'); } return path.endsWith('/accounts') ? {
  accounts: [
    { id: 'account-a', number: 1, connected: true, profile: { label: 'private@example.com' } },
    { id: 'account-b', number: 2, connected: true, needsReconnect: true },
  ],
} : { models: [
  { key: 'aisdk', defaultModel: 'opus', models: ['opus', 'sonnet'], thinkingLevels: ['low', 'medium', 'high'] },
  { key: 'codex-aisdk', defaultModel: 'gpt-6-astra', models: ['gpt-6-astra', 'gpt-5.3-codex'], thinkingLevels: ['low', 'high'] },
  { key: 'omg', defaultModel: 'omg/deepseek/deepseek-v4-flash-0731', models: ['omg/deepseek/deepseek-v4-flash-0731', 'omg/z-ai/glm-5.2', 'omg/qwen/qwen3-coder-next'],
    thinkingLevels: ['low', 'medium', 'high'],
    thinkingLevelsByModel: { 'omg/deepseek/deepseek-v4-flash-0731': ['low', 'medium', 'high'], 'omg/z-ai/glm-5.2': ['low', 'medium', 'high'] } },
] }; } } };
mock.module(resolve(import.meta.dir, '../src/omg/provider.tsx'), () => ({
  useOmg: () => ({ agents, bindingId, client, readiness }),
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

/**
 * THE MODEL LIST MUST SURVIVE A SLEEPING BOX.
 *
 * Reported 2026-09-19: "sometimes the model list and the rest is not
 * loading." Both of the picker's fetches used to fire on `client` alone, and
 * `client` exists as soon as `bindingId` is restored from storage -- before
 * the Computer is awake. The request got 425, the `.catch` set an empty list,
 * and the effect's only dependency was `client`, so it never ran again. The
 * box woke, the agent row filled in from readiness, and the model list stayed
 * empty for the whole app session.
 *
 * The two halves of the fix are asserted separately below: do not ask a box
 * that cannot answer, and do not give up on one that answered badly once.
 */
test('the catalog waits for the box instead of asking a sleeping one', async () => {
  const ui = mount();
  let picker!: ReturnType<typeof useAgentPicker>;
  function Fixture() { picker = useAgentPicker(); return null; }
  bindingId = 'machine-waking';
  readiness = { status: 'waking' };
  requests = 0;
  try {
    await ui.flushAsync(async () => { ui.render(<Fixture />); });
    // Nothing asked, so nothing failed, so nothing is stuck empty.
    expect(requests).toBe(0);
    expect(picker.modelOptions).toEqual([]);

    // The box wakes. The catalog arrives without a relaunch.
    readiness = { status: 'ready' };
    await ui.flushAsync(async () => { ui.render(<Fixture />); });
    expect(requests).toBeGreaterThan(0);
    expect(picker.modelOptions.map(o => o.label)).toEqual(['opus', 'sonnet']);
  } finally { ui.cleanup(); }
});

test('a fetch that fails once is tried again', async () => {
  const ui = mount();
  let picker!: ReturnType<typeof useAgentPicker>;
  function Fixture() { picker = useAgentPicker(); return null; }
  bindingId = 'machine-flaky';
  readiness = { status: 'ready' };
  // Both requests (accounts and models) fail on the first pass.
  failures = 2;
  try {
    await ui.flushAsync(async () => { ui.render(<Fixture />); });
    expect(picker.modelOptions).toEqual([]);
    // One shared retry timer, 3s. Wait past it and let the effect re-run.
    await ui.flushAsync(async () => { await new Promise(r => setTimeout(r, 3400)); });
    await ui.flushAsync(async () => { ui.render(<Fixture />); });
    expect(picker.modelOptions.map(o => o.label)).toEqual(['opus', 'sonnet']);
    expect(picker.accountOptions.map(o => o.label)).toEqual(['Auto', '1', '2']);
  } finally { ui.cleanup(); failures = 0; }
});

test('omg rows carry the short name and the provider mark, and keep the router id', async () => {
  const ui = mount();
  let picker!: ReturnType<typeof useAgentPicker>;
  function Fixture() { picker = useAgentPicker({ initialAgent: 'omg' }); return null; }
  bindingId = 'machine-omg';
  readiness = { status: 'ready' };
  try {
    await ui.flushAsync(async () => { ui.render(<Fixture />); });
    expect(picker.modelOptions.map(o => [o.id, o.label, o.image])).toEqual([
      ['omg/deepseek/deepseek-v4-flash-0731', 'DeepSeek V4 Flash', { uri: 'provider-deepseek' }],
      ['omg/z-ai/glm-5.2', 'GLM 5.2', { uri: 'provider-z-ai' }],
      ['omg/qwen/qwen3-coder-next', 'Qwen3 Coder Next', { uri: 'provider-qwen' }],
    ]);
    expect(picker.modelLabel).toBe('DeepSeek V4 Flash');
    // Levels follow the model: effort for DeepSeek, none for a model the router cannot steer.
    expect(picker.thinkingOptions.map(o => o.label)).toEqual(['Low', 'Medium', 'High']);
    expect(picker.thinkingOptions.find(o => o.selected)?.label).toBe('Medium');
    await ui.flushAsync(async () => { picker.modelOptions[1]!.onPress!(); });
    expect(picker.modelLabel).toBe('GLM 5.2');
    expect(picker.model).toBe('omg/z-ai/glm-5.2');
    await ui.flushAsync(async () => { picker.modelOptions[2]!.onPress!(); });
    expect(picker.modelLabel).toBe('Qwen3 Coder Next');
    expect(picker.thinkingOptions).toEqual([]);
  } finally { ui.cleanup(); }
});
