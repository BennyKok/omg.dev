/** Reveal after two stable layout frames, with a bound for continuous streams. */
export function openingReveal(reveal: () => void, schedule: (callback: () => void) => number,
  cancel: (id: number) => void, timeoutMs = 300) {
  let active = true;
  let frame: number | null = null;
  const finish = () => {
    if (!active) return;
    active = false;
    if (frame !== null) cancel(frame);
    clearTimeout(cap);
    reveal();
  };
  const cap = setTimeout(finish, timeoutMs);
  const changed = () => {
    if (!active) return;
    if (frame !== null) cancel(frame);
    frame = schedule(() => { frame = schedule(finish); });
  };
  changed();
  return { changed, cancel: () => {
    active = false;
    clearTimeout(cap);
    if (frame !== null) cancel(frame);
  } };
}
