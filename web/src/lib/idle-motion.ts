// Pause endless decorative animations in a window nobody is using.
//
// The mascot, spinners, typing dots and shimmer text loop forever. On a
// machine with no graphics card (the shared Computer desktop draws with
// SwiftShader) two idle omg.dev windows kept Chrome's drawing process at about
// 190% CPU, all day, to animate a screen nobody was looking at. Measured
// 2026-10-23: 326% with the loops running, 133% with them paused.
//
// The rule is narrow on purpose: the window must not have focus AND have had
// no pointer or key input for `idleMs`. Focus, a pointer move or a key press
// resumes everything at once. Data still updates while paused; only motion
// stops. The CSS half lives in index.css under :root[data-motion="paused"].

export type IdleMotionOptions = {
  idleMs?: number;
  checkEveryMs?: number;
  now?: () => number;
};

export function installIdleMotionPause(
  doc: Document = document,
  win: Window = window,
  options: IdleMotionOptions = {},
): () => void {
  const idleMs = options.idleMs ?? 120_000;
  const now = options.now ?? Date.now;
  let lastInput = now();
  const root = doc.documentElement;

  const apply = () => {
    const paused = !doc.hasFocus() && now() - lastInput >= idleMs;
    if (paused) {
      if (root.dataset.motion !== "paused") root.dataset.motion = "paused";
    } else if (root.dataset.motion === "paused") {
      delete root.dataset.motion;
    }
  };
  const onInput = () => {
    lastInput = now();
    apply();
  };

  const inputEvents = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "focus"] as const;
  for (const type of inputEvents) win.addEventListener(type, onInput, { passive: true, capture: true });
  doc.addEventListener("visibilitychange", apply);
  win.addEventListener("blur", apply);
  const timer = win.setInterval(apply, options.checkEveryMs ?? 10_000);

  return () => {
    for (const type of inputEvents) win.removeEventListener(type, onInput, { capture: true });
    doc.removeEventListener("visibilitychange", apply);
    win.removeEventListener("blur", apply);
    win.clearInterval(timer);
    delete root.dataset.motion;
  };
}
