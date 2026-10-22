// The test hook for `bun run check:play`. It is on only when the page link has
// `?test=1`, so a player never meets it by accident, and it changes nothing
// until the check uses it:
//   window.__omgTest.speed = 8   the game loop runs 8 steps per step, so a round ends quickly
//   window.__omgTest.input       the live Input object, to confirm a control reached the rules
//   window.__omgTest.kind        the control kind on the screen
// In test mode track() does not send analytics, so a check on the live link
// does not count as a player.
import type { ControlKind, Input } from "./input";

export type TestHook = { speed: number; input?: Input; kind?: ControlKind };

export const TEST_MODE: boolean =
  typeof location !== "undefined" && typeof window !== "undefined" && new URLSearchParams(location.search).get("test") === "1";

export const testHook: TestHook | null = TEST_MODE
  ? ((window as unknown as { __omgTest?: TestHook }).__omgTest ??= { speed: 1 })
  : null;

/** Game steps per real step: 1, or the test speed (whole number, 1 to 20). */
export function testSpeed(): number {
  const s = testHook?.speed ?? 1;
  return Number.isFinite(s) ? Math.min(20, Math.max(1, Math.round(s))) : 1;
}
