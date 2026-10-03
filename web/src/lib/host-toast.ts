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
 * The id of LFG's own Toaster.
 *
 * Sonner is a host-shared module, so a host's Toaster and ours read ONE toast
 * store. Sonner's rule: a Toaster with an `id` shows only toasts tagged with
 * that `toasterId`, and a Toaster without one shows only untagged toasts. So
 * when LFG draws its own stack it tags every toast with this id and mounts its
 * Toaster under it. Neither stack then shows the other's toasts, whichever
 * host version is on the other side. With `hostToast` set, toasts go untagged
 * to the host's Toaster and ours is not mounted.
 */
export const LFG_TOASTER_ID = "lfg";

// Methods whose options are the second argument. `dismiss(id)` has none.
const OPTION_METHODS = new Set([
  "success",
  "error",
  "info",
  "warning",
  "message",
  "loading",
  "custom",
  "promise",
]);

function withOwnToaster(args: unknown[]): unknown[] {
  if (hostToast) return args;
  const [first, options, ...rest] = args;
  const tagged =
    options && typeof options === "object"
      ? { toasterId: LFG_TOASTER_ID, ...(options as object) }
      : { toasterId: LFG_TOASTER_ID };
  return [first, tagged, ...rest];
}

/**
 * A stand-in for Sonner's `toast` that resolves its target on every call, so a
 * module that imported it before the host was configured still routes to the
 * host. Callable form and every method (success, loading, promise, custom,
 * dismiss, ...) are forwarded.
 */
export const routedToast: typeof sonnerToast = new Proxy(sonnerToast, {
  apply(_target, _this, args: Parameters<typeof sonnerToast>) {
    return (currentToast() as (...a: unknown[]) => ReturnType<typeof sonnerToast>)(
      ...withOwnToaster(args),
    );
  },
  get(_target, prop) {
    const target = currentToast();
    const value = Reflect.get(target, prop, target);
    if (typeof value !== "function") return value;
    const bound = value.bind(target) as (...a: unknown[]) => unknown;
    if (typeof prop === "string" && OPTION_METHODS.has(prop)) {
      return (...args: unknown[]) => bound(...withOwnToaster(args));
    }
    return bound;
  },
});
