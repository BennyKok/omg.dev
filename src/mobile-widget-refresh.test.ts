import { expect, test } from 'bun:test';
import { widgetRefresh } from '../mobile/src/omg/widget-refresh';
function setup(refresh: () => Promise<boolean>) {
  const timers: { run: () => void; delay: number; cancelled: boolean }[] = [];
  const errors: unknown[] = [];
  const writer = widgetRefresh({ refresh, onError: e => errors.push(e), schedule(run, delay) {
    const timer = { run, delay, cancelled: false }; timers.push(timer);
    return () => { timer.cancelled = true; };
  }});
  return { writer, timers, errors, current: () => timers.filter(t => !t.cancelled).at(-1) };
}
test('a failed wake-up fetch retries while foregrounded', async () => {
  let calls = 0;
  const t = setup(async () => ++calls > 1);
  await t.writer.foreground(true);
  expect(t.current()?.delay).toBe(5000);
  await t.writer.refresh();
  expect(calls).toBe(2);
  expect(t.current()?.delay).toBe(30000);
  t.writer.dispose();
});
test('status bursts coalesce without postponing the first scheduled refresh', async () => {
  const t = setup(async () => true);
  await t.writer.foreground(true);
  t.writer.changed();
  const first = t.current();
  for (let i=0;i<10;i++) t.writer.changed();
  expect(t.current()).toBe(first);
  expect(first?.delay).toBe(500);
  t.writer.dispose();
});
test('status received during a fetch causes one serialized follow-up', async () => {
  let release!: () => void;
  let calls = 0;
  const gate = new Promise<void>(resolve => { release=resolve; });
  const t = setup(async () => { calls++; if(calls===1) await gate; return true; });
  const pending = t.writer.foreground(true);
  await Promise.resolve();
  t.writer.changed(); t.writer.changed();
  expect(calls).toBe(1);
  release(); await pending;
  expect(calls).toBe(2);
  t.writer.dispose();
});
test('departure flushes once and background work does not poll', async () => {
  let calls = 0;
  const t = setup(async () => {calls++;return true;});
  await t.writer.foreground(true);
  await t.writer.foreground(false);
  expect(calls).toBe(2);
  expect(t.current()).toBeUndefined();
  t.writer.changed();
  expect(t.current()).toBeUndefined();
  t.writer.dispose();
});
test('disposed writers cannot start requests or schedule retries', async () => {
  let calls = 0;
  const t = setup(async () => {calls++;return false;});
  const pending=t.writer.foreground(true); t.writer.dispose(); await pending;
  await t.writer.refresh();
  expect(calls).toBe(0);
  expect(t.current()).toBeUndefined();
});
