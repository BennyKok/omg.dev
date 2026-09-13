/** Space below a new turn is consumed by the reply, not added after it. */
export function remainingReplySpace(reserved: number, followingHeights: readonly number[]): number {
  return Math.max(0, reserved - followingHeights.reduce((total, height) => total + Math.max(0, height), 0));
}

export type SendOrigin = { x: number; y: number; width: number; height: number };

/** Move the final-sized bubble from the composer centre without resizing it. */
export function sendOriginTransform(from: SendOrigin, target: SendOrigin) {
  'worklet';
  return {
    translateX: from.x + from.width / 2 - target.x - target.width / 2,
    translateY: from.y + from.height / 2 - target.y - target.height / 2,
  };
}

export type SendGeometry = { naturalHeight: number; rowTotal: number; bottomPadding: number };

/** Resolve against final geometry, never the keyboard's changing inset. */
export function sendTargetOffset(base: SendGeometry, rowTotal: number, footerHeight: number, replySpace: number, viewport: number): number {
  return Math.max(0, base.naturalHeight + rowTotal - base.rowTotal + footerHeight + replySpace + base.bottomPadding - viewport);
}
