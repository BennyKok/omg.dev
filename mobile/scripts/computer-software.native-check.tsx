/** @jsxImportSource ../../web/node_modules/react */
import { mount } from '../../web/src/test-support/render';
import { expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';
mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);

const View = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
mock.module(import.meta.resolve('react-native'), () => ({
  View,
  ActivityIndicator: () => <div>loading…</div>,
}));
mock.module(resolve(import.meta.dir, '../src/components.tsx'), () => ({
  Row: ({ children, icon }: { children?: React.ReactNode; icon?: React.ReactNode }) =>
    <div>{icon}{children}</div>,
  Separator: () => null,
  SettingsIcon: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Icon: () => null,
}));
mock.module(resolve(import.meta.dir, '../src/omg/motion.tsx'), () => ({
  PressableScale: ({ children, onPress, disabled, accessibilityLabel }: {
    children?: React.ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string;
  }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>,
}));
mock.module(resolve(import.meta.dir, '../src/omg/text.tsx'), () => ({ Text: View }));
mock.module(resolve(import.meta.dir, '../src/omg/theme.ts'), () => ({
  useTheme: () => ({ colors: {}, type: {}, radius: {} }),
}));

const { ComputerSoftwareRow } = await import('../src/omg/computer-software-row');
const release = (update: Record<string, unknown> | null) =>
  ({ channel: 'release' as const, update: update as never });

test('names the running version when there is nothing to do, and offers only a check', () => {
  const ui = mount();
  try {
    ui.render(<ComputerSoftwareRow install={release({
      state: 'up-to-date', message: 'omg.dev 0.6.89 is up to date.',
      currentVersion: '0.6.89', restartSupported: true,
    })} />);
    expect(ui.text()).toContain('Software');
    expect(ui.text()).toContain('0.6.89');
    expect(ui.text()).toContain('Check');
    expect(ui.text()).not.toContain('Update');
  } finally { ui.cleanup(); }
});

test('an available update names both versions and offers Update', () => {
  const ui = mount();
  let applied = 0;
  try {
    ui.render(<ComputerSoftwareRow
      install={release({
        state: 'available', message: 'Update available', currentVersion: '0.6.80',
        latestVersion: '0.6.89', restartSupported: true,
      })}
      onApply={() => { applied++; }}
    />);
    expect(ui.text()).toContain('0.6.80');
    expect(ui.text()).toContain('0.6.89 available');
    const button = ui.query('button[aria-label="Update the computer"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    ui.flush(() => button!.click());
    expect(applied).toBe(1);
  } finally { ui.cleanup(); }
});

test('bits already on disk ask for a restart, not another download', () => {
  const ui = mount();
  try {
    ui.render(<ComputerSoftwareRow install={release({
      state: 'staged', message: 'staged', currentVersion: '0.6.80',
      latestVersion: '0.6.89', restartSupported: true,
    })} />);
    expect(ui.text()).toContain('restart to finish');
    expect(ui.query('button[aria-label="Restart the computer"]')).toBeTruthy();
    expect(ui.query('button[aria-label="Update the computer"]')).toBeNull();
  } finally { ui.cleanup(); }
});

test('a box that cannot restart itself says why and offers no button', () => {
  const ui = mount();
  try {
    ui.render(<ComputerSoftwareRow install={release({
      state: 'available', message: 'Update available', currentVersion: '0.6.80',
      latestVersion: '0.6.89', restartSupported: false,
      restartBlockedReason: 'No service manager on this host.',
    })} />);
    expect(ui.text()).toContain('No service manager on this host.');
    expect(ui.query('button[aria-label="Update the computer"]')).toBeNull();
  } finally { ui.cleanup(); }
});

test('a computer that never answered leaves the row out entirely', () => {
  const ui = mount();
  try {
    ui.render(<ComputerSoftwareRow install={null} />);
    expect(ui.text()).not.toContain('Software');
  } finally { ui.cleanup(); }
});

test('restarting says so instead of showing a stale version line', () => {
  const ui = mount();
  try {
    ui.render(<ComputerSoftwareRow
      install={release({
        state: 'staged', message: 'staged', currentVersion: '0.6.80', restartSupported: true,
      })}
      restarting
      busy
    />);
    expect(ui.text()).toContain('Restarting the computer…');
    expect(ui.text()).not.toContain('restart to finish');
  } finally { ui.cleanup(); }
});
