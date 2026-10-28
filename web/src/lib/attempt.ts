/**
 * `try`/`catch`/`finally` for code that lives inside a React component.
 *
 * React Compiler 1.0 skips a whole component, nested callbacks included, when
 * its body has a `try` with `finally`, a `try` without `catch`, a `throw`
 * inside `try`, or a conditional expression (`?.`, `??`, `&&`, `? :`) inside
 * `try`. A skipped component re-renders every child on every render. These
 * helpers hold the `try` outside the component, so the component compiles and
 * the behavior stays the same.
 *
 * Without `onError`, the error propagates (like `try`/`finally`). With it, its
 * return value is the result. `onFinally` runs after both, and runs before the
 * error propagates.
 */
export function attempt<T, F = never>(
  work: () => T,
  onError?: (error: unknown) => F,
  onFinally?: () => void,
): T | F {
  try {
    return work();
  } catch (error) {
    if (!onError) throw error;
    return onError(error);
  } finally {
    onFinally?.();
  }
}

/**
 * The async form of {@link attempt}. `onError` and `onFinally` may be async;
 * the returned promise settles after both have finished.
 */
export async function attemptAsync<T, F = never>(
  work: () => Promise<T>,
  onError?: (error: unknown) => F | Promise<F>,
  onFinally?: () => void | Promise<void>,
): Promise<T | F> {
  try {
    return await work();
  } catch (error) {
    if (!onError) throw error;
    return await onError(error);
  } finally {
    await onFinally?.();
  }
}

/** The message of an unknown error value, for toasts and inline errors. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
