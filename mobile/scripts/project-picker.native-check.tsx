/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module('expo-router', () => ({ useRouter: () => ({ push: () => {} }) }));
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);
mock.module(import.meta.resolve('@react-native-async-storage/async-storage'), () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}));
mock.module(resolve(import.meta.dir, '../src/omg/config.ts'), () => ({ STORAGE_KEYS: { folderRail: 'rail' } }));
mock.module(resolve(import.meta.dir, '../src/omg/agent-icons.ts'), () => ({ agentIcon: () => undefined, agentLabel: (key: string) => key }));
mock.module(resolve(import.meta.dir, '../src/omg/model-provider-icons.ts'), () => ({ modelProviderIcon: () => null }));
let repos = [{ name: 'Website', cwd: '/repos/site', project: 'site' }];
mock.module(resolve(import.meta.dir, '../src/omg/provider.tsx'), () => ({
  useOmg: () => ({ repos, bindings: [{ id: 'test', defaultFolder: '/repos/site' }], bindingId: 'test', client: null, probe: async () => {} }),
}));
const { useProjectPicker } = await import('../src/omg/session-options');
test('unassigned selection cannot silently fall back to the default project', async () => {
  const ui = mount();
  let picker!: ReturnType<typeof useProjectPicker>;
  function Fixture() { picker = useProjectPicker(); return null; }
  try {
    await ui.flushAsync(async () => { ui.render(<Fixture />); });
    // Home opens on no project, not the machine's default folder.
    expect(picker.cwd).toBeNull();
    expect(picker.unassigned).toBe(true);
    ui.flush(() => picker.options[0].onPress?.());
    expect(picker.cwd).toBe('/repos/site');
    ui.flush(() => picker.selectUnassigned());
    expect(picker.cwd).toBeNull();
    expect(picker.unassigned).toBe(true);
    expect(picker.matches({ project: '' })).toBe(true);
    expect(picker.matches({ project: 'site' })).toBe(false);
    repos = [...repos];
    ui.render(<Fixture />);
    expect(picker.cwd).toBeNull();
    ui.flush(() => picker.options[0].onPress?.());
    expect(picker.cwd).toBe('/repos/site');
    expect(picker.unassigned).toBe(false);
  } finally { ui.cleanup(); }
});


test('pressing a selected project clears the filter without choosing a composer folder', async () => {
  const ui = mount();
  let picker!: ReturnType<typeof useProjectPicker>;
  function Fixture() { picker = useProjectPicker(); return null; }
  try {
    await ui.flushAsync(async () => { ui.render(<Fixture />); });
    ui.flush(() => picker.options[0].onPress?.());
    expect(picker.matches({ project: 'site' })).toBe(true);
    expect(picker.matches({ project: 'other' })).toBe(false);
    ui.flush(() => picker.options[0].onPress?.());
    expect(picker.allProjects).toBe(true);
    expect(picker.options.every((option) => !option.selected)).toBe(true);
    expect(picker.cwd).toBeNull();
    expect(picker.matches({ project: 'site' })).toBe(true);
    expect(picker.matches({ project: 'other' })).toBe(true);
    expect(picker.matches({ project: '' })).toBe(true);
    repos = [...repos];
    ui.render(<Fixture />);
    expect(picker.allProjects).toBe(true);
    ui.flush(() => picker.selectUnassigned());
    expect(picker.matches({ project: 'site' })).toBe(false);
    ui.flush(() => picker.selectAll());
    expect(picker.matches({ project: 'site' })).toBe(true);
    ui.flush(() => picker.selectProject('site'));
    expect(picker.cwd).toBe('/repos/site');
    expect(picker.matches({ project: 'other' })).toBe(false);
    ui.flush(() => picker.selectProject(''));
    expect(picker.unassigned).toBe(true);
  } finally { ui.cleanup(); }
});
