// Where this bundle's toasts are drawn.
//
// A standalone LFG draws its own Sonner stack. An embedded surface shares the
// host's document, and its stack used to render INSIDE the surface's container.
// The host gives that container a z-index, which makes it a stacking context,
// so every LFG toast was capped at the host's page layer: under the host's own
// floating chrome, sheets, dialogs and cookie banner, and in a different place
// from the host's own toasts. No z-index inside the surface can escape that.
//
// The structural fix is one toast owner per document. A host that already runs
// a Toaster hands its `toast` function to the surface (`hostToast`), and every
// LFG toast goes through it. The surface then mounts no Toaster of its own.

import { toast as sonnerToast } from "sonner";

/**
 * The host's toast function. Sonner's `toast` export satisfies this as is, and
 * that is the expected value: React is shared with the host, so JSX titles,
 * actions and `toast.custom` renderers work unchanged in the host's stack.
 */
export type OmgHostToast = typeof sonnerToast;

let hostToast: OmgHostToast | null = null;

/** Declared by the embedded surfaces, synchronously, before children render. */
export function configureHostToast(next: OmgHostToast | null): void {
  hostToast = next;
}

/** True when a host owns the toast stack, so LFG must not mount its own. */
export function hasHostToast(): boolean {
  return hostToast !== null;
}

/** The toast function to call right now: the host's when set, else ours. */
export function currentToast(): typeof sonnerToast {
  return hostToast ?? sonnerToast;
}

/**
 * A stand-in for Sonner's `toast` that resolves its target on every call, so a
 * module that imported it before the host was configured still routes to the
 * host. Callable form and every method (success, loading, promise, custom,
 * dismiss, ...) are forwarded.
 */
export const routedToast: typeof sonnerToast = new Proxy(sonnerToast, {
  apply(_target, _this, args: Parameters<typeof sonnerToast>) {
    return currentToast()(...args);
  },
  get(_target, prop) {
    const target = currentToast();
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
