'use dom';

/**
 * The Computer, on a phone: the desktop's live screen, a trackpad, and the
 * iOS keyboard wired straight through to it.
 *
 * ── Why this screen was rebuilt ───────────────────────────────────────────
 *
 * The first version put a compose field and a Send button under the screen.
 * Three things were wrong with it, and all three are visible in one
 * screenshot taken on device:
 *
 *  1. The chrome ate the screen. A 44pt toolbar band, a 54pt text box, a row
 *     of key buttons and a hint line came to about 220pt BELOW the desktop,
 *     and the keyboard took the rest. The live screen was a black strip.
 *  2. Typing was not typing. You composed a message, pressed Send, and it
 *     arrived as a clipboard paste. Nothing you typed reached the desktop
 *     until you pressed a button, so a shell prompt, a password field, a
 *     Vim buffer and a keyboard shortcut were all out of reach.
 *  3. It did not match the web Computer view, which has always forwarded
 *     each key the moment it is pressed (web/src/views/computer-page.tsx).
 *
 * So: no compose field, no Send. An invisible focus field raises the iOS
 * keyboard and every key it produces is forwarded to RFB immediately. The
 * controls are one floating pill over the screen instead of a band under it,
 * and the space the keyboard covers is measured rather than guessed, so the
 * desktop keeps every pixel that is actually visible.
 *
 * The RFB protocol stays entirely noVNC's. This file only synthesises DOM
 * events at a virtual cursor and calls the public `sendKey`.
 */

import RFB from "@novnc/novnc";
import { useCallback, useEffect, useRef, useState } from "react";

import { dark } from "./palette";

type Props = {
  socketUrl: string;
  protocol: string;
  preview?: boolean;
  /**
   * How much of this webview the iOS keyboard covers, in points, measured by
   * the native screen. See `useKeyboardInset` for why a web-only measurement
   * is not enough on its own.
   */
  keyboardInset?: number;
  dom?: import("expo/dom").DOMProps;
};

type Point = { x: number; y: number };
type TouchState = Point & { moved: boolean; at: number; handled: boolean };
type Mods = { ctrl: boolean; alt: boolean };

/** X11 keysyms for the keys that carry no character. */
const KEYSYM = {
  backspace: 0xff08,
  tab: 0xff09,
  enter: 0xff0d,
  escape: 0xff1b,
  home: 0xff50,
  left: 0xff51,
  up: 0xff52,
  right: 0xff53,
  down: 0xff54,
  pageUp: 0xff55,
  pageDown: 0xff56,
  end: 0xff57,
  ctrl: 0xffe3,
  alt: 0xffe9,
} as const;

/**
 * Hardware-keyboard keys that produce no `input` event, so the text path
 * below never sees them. Backspace and Enter are deliberately NOT here: in a
 * textarea they both produce an `input` event, and handling them twice would
 * send every one of them twice.
 */
const NAMED_KEYS: Record<string, number> = {
  Escape: KEYSYM.escape,
  Tab: KEYSYM.tab,
  ArrowLeft: KEYSYM.left,
  ArrowUp: KEYSYM.up,
  ArrowRight: KEYSYM.right,
  ArrowDown: KEYSYM.down,
  Home: KEYSYM.home,
  End: KEYSYM.end,
  PageUp: KEYSYM.pageUp,
  PageDown: KEYSYM.pageDown,
};

/**
 * THE FOCUS FIELD IS NEVER EMPTY, AND THAT IS THE POINT.
 *
 * Nothing you type is ever shown, so the obvious design is a field that is
 * cleared after every keystroke. It does not work: iOS raises a delete event
 * only when there is something to delete, so backspace on an empty field is
 * silent, and holding backspace repeats only while the field keeps shrinking.
 *
 * The field is therefore kept full of newlines nobody sees. Each backspace
 * eats one of them and is forwarded to the desktop. The pad is topped up only
 * once it runs low, so a held backspace repeats at the keyboard's own rate
 * instead of being cut off by a value assignment on every repeat.
 *
 * Newlines rather than spaces or letters: predictive text and autocorrect
 * have nothing to work with, and no word can be suggested out of them.
 */
const PAD = "\n".repeat(160);
const PAD_MIN = 24;

/** How long a finger must rest, in ms, before a press means right click. */
const LONG_PRESS_MS = 500;

function dispatchMouse(
  canvas: HTMLCanvasElement,
  at: Point,
  type: "mousemove" | "mousedown" | "mouseup",
  buttons: number,
  button = 0,
) {
  // noVNC installs a window-level capture proxy on press. The release must
  // reach that proxy, or its transparent layer remains above the trackpad.
  const target = type === "mouseup" ? canvas.ownerDocument.defaultView! : canvas;
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    button,
    buttons,
  }));
}

/**
 * How many points at the bottom of this webview are hidden under the iOS
 * keyboard, from whichever source actually knows.
 *
 * There are three ways a WKWebView can react to the keyboard and they are not
 * distinguishable in advance:
 *
 *  - it shrinks the LAYOUT viewport, and a `position: fixed` box already ends
 *    at the top of the keyboard. Nothing more to do.
 *  - it shrinks only the VISUAL viewport, and `visualViewport` reports the
 *    difference while `innerHeight` does not move.
 *  - it does neither, and only the native side knows, from the keyboard frame
 *    that UIKit reports.
 *
 * Taking the larger of "what the visual viewport lost" and "what the native
 * measurement says is left over after any layout shrink" is correct in all
 * three cases and cannot double-count in any of them.
 */
function useKeyboardInset(nativeInset: number): number {
  const [inset, setInset] = useState(0);
  /** The layout viewport height while nothing covers it. */
  const baseRef = useRef(0);

  useEffect(() => {
    const viewport = window.visualViewport ?? null;
    const measure = () => {
      // Re-baseline whenever the keyboard is down, so a rotation or a split
      // view does not leave a stale reference height behind.
      if (nativeInset === 0) baseRef.current = window.innerHeight;
      const layoutShrink = Math.max(0, baseRef.current - window.innerHeight);
      const visualShrink = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      const measured = Math.max(visualShrink, Math.max(0, nativeInset - layoutShrink));
      // Never let the chrome collapse the screen entirely, whatever arrives.
      setInset(Math.min(measured, Math.max(0, window.innerHeight - 120)));
      // WebKit scrolls a focused caret into view even in a fixed layout. The
      // page has nowhere to go, so put it back rather than leave the whole UI
      // shifted up by a few points.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    measure();
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [nativeInset]);

  return inset;
}

export default function ComputerControlDom({
  socketUrl,
  protocol,
  preview = false,
  keyboardInset = 0,
}: Props) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const cursorRef = useRef<Point | null>(null);
  const touchRef = useRef<TouchState | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** How many pad characters the field is expected to hold right now. */
  const padRef = useRef(0);
  const composingRef = useRef(false);
  /** Mirrors `control` for the natively bound handlers, which see no state. */
  const controlRef = useRef(false);
  const modsRef = useRef<Mods>({ ctrl: false, alt: false });

  const [phase, setPhase] = useState<"connecting" | "live" | "error">("connecting");
  const [control, setControl] = useState(false);
  const [typing, setTyping] = useState(false);
  const [mods, setMods] = useState<Mods>({ ctrl: false, alt: false });
  const [notice, setNotice] = useState<string | null>(null);

  const inset = useKeyboardInset(typing ? keyboardInset : 0);

  useEffect(() => {
    if (preview) {
      setPhase("live");
      return;
    }
    const host = screenRef.current;
    if (!host) return;
    setPhase("connecting");
    const socket = new WebSocket(socketUrl, [protocol]);
    socket.binaryType = "arraybuffer";
    const rfb = new RFB(host, socket, { shared: true });
    rfb.scaleViewport = true;
    rfb.showDotCursor = true;
    rfb.background = dark.background;
    // Read-only is the safe default on a shared screen: opening this must not
    // land a stray tap on whatever the agent is doing.
    rfb.viewOnly = !controlRef.current;
    rfb.addEventListener("connect", () => setPhase("live"));
    rfb.addEventListener("disconnect", () => setPhase("error"));
    rfbRef.current = rfb;
    return () => {
      rfbRef.current = null;
      try { rfb.disconnect(); } catch {}
    };
  }, [socketUrl, protocol, preview]);

  useEffect(() => {
    if (rfbRef.current) rfbRef.current.viewOnly = !control;
  }, [control]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  // ── Pointer ──────────────────────────────────────────────────────────────

  const canvas = useCallback(() => screenRef.current?.querySelector("canvas") ?? null, []);

  /**
   * Where the virtual cursor is, parking it in the middle of the screen the
   * first time anything asks. Without this, Right click did nothing at all
   * until you had dragged at least once: there was no position to click at,
   * so the press was never synthesised and the button looked broken.
   */
  const cursorOn = useCallback((target: HTMLCanvasElement): Point => {
    if (!cursorRef.current) {
      const box = target.getBoundingClientRect();
      cursorRef.current = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return cursorRef.current;
  }, []);

  const emit = useCallback((type: "mousemove" | "mousedown" | "mouseup", buttons: number, button = 0) => {
    const target = canvas();
    if (!target) return;
    dispatchMouse(target, cursorOn(target), type, buttons, button);
  }, [canvas, cursorOn]);

  const move = useCallback((dx: number, dy: number) => {
    const target = canvas();
    if (!target) return;
    const box = target.getBoundingClientRect();
    const at = cursorOn(target);
    cursorRef.current = {
      x: Math.min(box.right - 1, Math.max(box.left, at.x + dx)),
      y: Math.min(box.bottom - 1, Math.max(box.top, at.y + dy)),
    };
    emit("mousemove", 0);
  }, [canvas, cursorOn, emit]);

  const click = useCallback((button: 0 | 2) => {
    emit("mousedown", button === 2 ? 2 : 1, button);
    emit("mouseup", 0, button);
  }, [emit]);

  // ── Keys ─────────────────────────────────────────────────────────────────

  const takeControl = useCallback(() => {
    controlRef.current = true;
    if (rfbRef.current) rfbRef.current.viewOnly = false;
    setControl(true);
  }, []);

  /**
   * Press and release one key, wrapped in whatever modifiers are latched.
   * A latched modifier applies to exactly one key and then clears, which is
   * how ctrl+c reaches a terminal from a keyboard that has no ctrl.
   */
  const sendKeysym = useCallback((keysym: number, code: string | null) => {
    const rfb = rfbRef.current;
    if (!rfb || !controlRef.current) return;
    const held: [number, string][] = [];
    if (modsRef.current.ctrl) held.push([KEYSYM.ctrl, "ControlLeft"]);
    if (modsRef.current.alt) held.push([KEYSYM.alt, "AltLeft"]);
    for (const [held_key, held_code] of held) rfb.sendKey(held_key, held_code, true);
    rfb.sendKey(keysym, code, true);
    rfb.sendKey(keysym, code, false);
    for (const [held_key, held_code] of held.reverse()) rfb.sendKey(held_key, held_code, false);
    if (held.length) {
      modsRef.current = { ctrl: false, alt: false };
      setMods({ ctrl: false, alt: false });
    }
  }, []);

  const sendText = useCallback((text: string) => {
    for (const character of text) {
      if (character === "\n" || character === "\r") {
        sendKeysym(KEYSYM.enter, "Enter");
        continue;
      }
      const point = character.codePointAt(0) ?? 0;
      // Latin-1 is its own keysym; anything above uses the Unicode plane
      // offset X11 defines.
      sendKeysym(point < 0x100 ? point : 0x01000000 + point, null);
    }
  }, [sendKeysym]);

  const refillPad = useCallback((field: HTMLTextAreaElement) => {
    field.value = PAD;
    padRef.current = PAD.length;
    try { field.setSelectionRange(PAD.length, PAD.length); } catch {}
  }, []);

  const onFieldInput = useCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget;
    // An IME is mid-word. Let it finish; compositionend sends the result.
    if (composingRef.current) return;
    const value = field.value;
    const expected = padRef.current;
    if (value.length < expected) {
      const removed = Math.max(1, expected - value.length);
      for (let index = 0; index < removed; index += 1) sendKeysym(KEYSYM.backspace, "Backspace");
      padRef.current = value.length;
      if (value.length < PAD_MIN) refillPad(field);
      return;
    }
    sendText(value.slice(expected));
    refillPad(field);
  }, [refillPad, sendKeysym, sendText]);

  const openKeyboard = useCallback(() => {
    takeControl();
    const field = fieldRef.current;
    if (!field) return;
    refillPad(field);
    field.focus();
  }, [refillPad, takeControl]);

  const closeKeyboard = useCallback(() => fieldRef.current?.blur(), []);

  const toggleControl = useCallback(() => {
    if (controlRef.current) {
      controlRef.current = false;
      modsRef.current = { ctrl: false, alt: false };
      setMods({ ctrl: false, alt: false });
      setControl(false);
      closeKeyboard();
      setNotice("View only. The Computer ignores your touches.");
      return;
    }
    takeControl();
    setNotice("Drag to move the pointer. Tap to click.");
  }, [closeKeyboard, takeControl]);

  const rightClick = useCallback(() => {
    takeControl();
    click(2);
  }, [click, takeControl]);

  /**
   * Props for a control that must act WITHOUT taking focus off the field.
   *
   * Cancelling `mousedown` holds the focus, and on device that is exactly
   * what it does — but WebKit then swallows the click that follows a touch,
   * so the key did nothing at all. Verified on an iPhone 17 Pro simulator on
   * 2026-09-21: the keyboard stayed up and `ctrl` never latched.
   *
   * So the press IS the action. Cancelling `pointerdown` stops the emulated
   * mousedown that would move focus, and the handler does the work there
   * instead of waiting for a click. `onClick` stays for VoiceOver and a
   * hardware keyboard, which activate with no pointer event at all, and the
   * guard stops a browser that still delivers both from sending the key
   * twice.
   */
  const pressedAt = useRef(0);
  const holdFocus = useCallback((action: () => void) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      pressedAt.current = Date.now();
      action();
    },
    onClick: () => {
      if (Date.now() - pressedAt.current < 700) return;
      action();
    },
  }), []);

  const toggleMod = useCallback((name: keyof Mods) => {
    const next = { ...modsRef.current, [name]: !modsRef.current[name] };
    modsRef.current = next;
    setMods(next);
  }, []);

  // ── The trackpad ─────────────────────────────────────────────────────────
  //
  // Bound natively rather than through React. React registers touch listeners
  // as PASSIVE, so preventDefault there is ignored, and without it the browser
  // fires its compatibility mouse events a moment after each touchend. Those
  // land while the next finger is already down, which is what made a drag
  // straight after a tap feel stuck.
  useEffect(() => {
    const target = overlayRef.current;
    if (!target || !control) return;
    const cancelLongPress = () => {
      if (longPressRef.current) clearTimeout(longPressRef.current);
      longPressRef.current = null;
    };
    const start = (event: TouchEvent) => {
      event.preventDefault();
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const state: TouchState = {
        x: touch.clientX, y: touch.clientY, moved: false, at: Date.now(), handled: false,
      };
      touchRef.current = state;
      cancelLongPress();
      // A finger resting in place is the natural right click on a trackpad,
      // and it saves a trip to the toolbar mid-task.
      longPressRef.current = setTimeout(() => {
        longPressRef.current = null;
        if (touchRef.current !== state || state.moved) return;
        state.handled = true;
        click(2);
      }, LONG_PRESS_MS);
    };
    const moveTouch = (event: TouchEvent) => {
      event.preventDefault();
      const previous = touchRef.current;
      if (!previous || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - previous.x;
      const dy = touch.clientY - previous.y;
      // 3px of slop, so the wobble of a real tap is not read as a drag.
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        previous.moved = true;
        cancelLongPress();
      }
      // Mild acceleration: slow drags stay precise, fast ones cross the screen.
      const speed = Math.min(2.5, 1 + Math.hypot(dx, dy) / 12);
      move(dx * speed, dy * speed);
      previous.x = touch.clientX;
      previous.y = touch.clientY;
    };
    const end = (event: TouchEvent) => {
      event.preventDefault();
      const previous = touchRef.current;
      touchRef.current = null;
      cancelLongPress();
      // A tap clicks WHERE THE CURSOR IS, not where the finger landed. That is
      // the whole point of relative pointing.
      if (previous && !previous.handled && !previous.moved && Date.now() - previous.at < 400) {
        click(0);
      }
    };
    target.addEventListener("touchstart", start, { passive: false });
    target.addEventListener("touchmove", moveTouch, { passive: false });
    target.addEventListener("touchend", end, { passive: false });
    target.addEventListener("touchcancel", end, { passive: false });
    return () => {
      cancelLongPress();
      target.removeEventListener("touchstart", start);
      target.removeEventListener("touchmove", moveTouch);
      target.removeEventListener("touchend", end);
      target.removeEventListener("touchcancel", end);
    };
  }, [control, click, move]);

  const keys: { label: string; key: string; press: () => void; on?: boolean }[] = [
    { label: "esc", key: "esc", press: () => sendKeysym(KEYSYM.escape, "Escape") },
    { label: "tab", key: "tab", press: () => sendKeysym(KEYSYM.tab, "Tab") },
    { label: "ctrl", key: "ctrl", press: () => toggleMod("ctrl"), on: mods.ctrl },
    { label: "alt", key: "alt", press: () => toggleMod("alt"), on: mods.alt },
    { label: "←", key: "left", press: () => sendKeysym(KEYSYM.left, "ArrowLeft") },
    { label: "↑", key: "up", press: () => sendKeysym(KEYSYM.up, "ArrowUp") },
    { label: "↓", key: "down", press: () => sendKeysym(KEYSYM.down, "ArrowDown") },
    { label: "→", key: "right", press: () => sendKeysym(KEYSYM.right, "ArrowRight") },
  ];

  return (
    <main
      style={{ ...styles.root, bottom: inset }}
      data-testid="computer-control-viewer"
      data-keyboard-inset={inset}
    >
      <section style={styles.screen}>
        <div ref={screenRef} style={styles.frame} />
        {preview ? (
          <div style={styles.preview} aria-label="Demo computer desktop">
            <div style={styles.previewBar}>Your Computer</div>
            <div style={styles.previewWindow}>
              <div style={styles.previewWindowBar}>Browser</div>
              <div style={styles.previewContent}>
                <strong>Remote Computer</strong>
                <span>The live screen appears here.</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* The trackpad surface. Above noVNC's canvas so its own gesture
            handler never sees these touches: two pointer models fighting over
            one finger is worse than either alone. */}
        <div
          ref={overlayRef}
          aria-hidden="true"
          style={{ ...styles.overlay, pointerEvents: control ? "auto" : "none" }}
        />

        {phase !== "live" ? (
          <div style={styles.status} role="status">
            {phase === "error" ? "Connection lost" : "Connecting to screen…"}
          </div>
        ) : null}

        {notice ? (
          <div style={styles.notice} role="status" aria-live="polite">{notice}</div>
        ) : null}

        {/* One floating pill instead of a toolbar band. It costs the desktop
            no height at all, which is the entire reason the screen is now
            usable with the keyboard open. */}
        <div style={styles.bar} role="toolbar" aria-label="Computer controls">
          <button
            type="button"
            style={control ? styles.controlOn : styles.controlOff}
            data-testid="computer-take-control"
            aria-pressed={control}
            aria-label={control
              ? "Controlling. Drag to move the pointer. Tap to click."
              : "Take control. The Computer is view only."}
            onClick={toggleControl}
          >
            <PointerIcon />
            {control ? "Controlling" : "Take control"}
          </button>
          <span style={styles.divider} aria-hidden="true" />
          <button
            type="button"
            style={typing ? styles.iconOn : styles.icon}
            data-testid="computer-keyboard"
            aria-pressed={typing}
            // "Show keyboard", never the bare word: `scripts/e2e-jev.ts`
            // drops any element labelled exactly "Keyboard", which is how it
            // keeps the hundred one-letter keys of the iOS keyboard out of
            // its candidate list. Naming the action is clearer anyway, and it
            // matches the web viewer.
            aria-label={typing ? "Hide keyboard" : "Show keyboard"}
            onClick={typing ? closeKeyboard : openKeyboard}
          >
            <KeyboardIcon />
          </button>
          <button
            type="button"
            style={styles.icon}
            data-testid="computer-right-click"
            aria-label="Right click"
            {...holdFocus(rightClick)}
          >
            <RightClickIcon />
          </button>
        </div>
      </section>

      {/* Keys the iOS keyboard does not have, docked where the system's own
          accessory bar used to be (computer.tsx hides that one). */}
      {typing ? (
        <div style={styles.keyRow} role="toolbar" aria-label="Keyboard keys">
          <div style={styles.keyScroller}>
            {keys.map((item) => (
              <button
                key={item.key}
                type="button"
                style={item.on ? styles.keyOn : styles.key}
                aria-pressed={item.on}
                aria-label={item.label}
                {...holdFocus(item.press)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            style={styles.hide}
            aria-label="Hide keyboard"
            onClick={closeKeyboard}
          >
            ⌄
          </button>
        </div>
      ) : null}

      {/* Exists only to raise the iOS keyboard and to receive what it types: a
          canvas cannot hold focus, so the OS has nothing to attach a keyboard
          to. Never shows a character — every key is forwarded on arrival.

          It is one point tall at the bottom edge, so while the keyboard is
          down it is a control nobody can actually hit: a screen reader would
          offer it, and an automated run did repeatedly aim at it, and the
          press landed on the home indicator instead. The Keyboard button IS
          the way in, and it has a label that says so. While the keyboard is
          up the field comes back, so a screen reader can report where the
          keys are going. */}
      <textarea
        ref={fieldRef}
        style={styles.field}
        aria-hidden={typing ? undefined : true}
        tabIndex={-1}
        aria-label="Computer keyboard. Every key you press goes to the Computer."
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onFocus={(event) => { refillPad(event.currentTarget); setTyping(true); }}
        onBlur={(event) => {
          event.currentTarget.value = "";
          padRef.current = 0;
          composingRef.current = false;
          modsRef.current = { ctrl: false, alt: false };
          setMods({ ctrl: false, alt: false });
          setTyping(false);
        }}
        onInput={onFieldInput}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const field = event.currentTarget;
          sendText(field.value.slice(padRef.current));
          refillPad(field);
        }}
        onPaste={(event) => {
          const rfb = rfbRef.current;
          const text = event.clipboardData.getData("text");
          if (!rfb || !text || !controlRef.current) return;
          // A real paste, through the desktop's own clipboard: paste handlers
          // fire over there and a split code field still works, neither of
          // which is true of one key per character.
          event.preventDefault();
          rfb.clipboardPasteFrom(text);
          rfb.sendKey(KEYSYM.ctrl, "ControlLeft", true);
          rfb.sendKey(0x76, "KeyV", true);
          rfb.sendKey(0x76, "KeyV", false);
          rfb.sendKey(KEYSYM.ctrl, "ControlLeft", false);
          refillPad(event.currentTarget);
        }}
        onKeyDown={(event) => {
          const keysym = NAMED_KEYS[event.key];
          if (!keysym) return;
          event.preventDefault();
          sendKeysym(keysym, event.code || null);
        }}
      />
    </main>
  );
}

function PointerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 2.5 19 11l-6.4 1.4L9.6 19z" fill="currentColor" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2.5" y="5.5" width="19" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 9.5h1m3 0h1m3 0h1m3 0h1M6.5 12.5h1m3 0h1m3 0h1m3 0h1M8.5 15.5h7"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function RightClickIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="6" y="2.8" width="12" height="18.4" rx="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 3.6h3.2A2.8 2.8 0 0 1 18 6.4v4.6h-6z" fill="currentColor" />
    </svg>
  );
}

/** The glass the floating chrome is made of. Dark whatever the phone is set
 *  to: this is a screen viewer, and its chrome sits on someone else's pixels. */
const GLASS = "rgba(28, 28, 30, 0.74)";
const HAIRLINE = "rgba(255, 255, 255, 0.14)";
const FILL = "rgba(255, 255, 255, 0.12)";

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    display: "flex",
    flexDirection: "column",
    background: dark.background,
    color: dark.foreground,
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    overflow: "hidden",
    // Matches the iOS keyboard's own curve, so the screen resizes with it
    // rather than snapping after it.
    transition: "bottom 250ms cubic-bezier(0.17, 0.59, 0.4, 1)",
  },
  screen: { position: "relative", flex: 1, minHeight: 0, background: dark.background },
  frame: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  overlay: { position: "absolute", inset: 0, zIndex: 2, touchAction: "none", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" },
  preview: { position: "absolute", inset: 0, padding: 18, background: "linear-gradient(145deg, #24385d, #151b2b 65%)" },
  previewBar: { height: 28, color: "#d8deea", fontSize: 12, fontWeight: 600 },
  previewWindow: { width: "82%", height: "76%", margin: "2% auto 0", borderRadius: 10, overflow: "hidden", background: "#f7f7f8", boxShadow: "0 18px 50px rgba(0,0,0,.35)" },
  previewWindowBar: { height: 30, padding: "8px 12px", background: "#e7e7ea", color: "#55555d", fontSize: 11 },
  previewContent: { height: "calc(100% - 30px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#202027", fontSize: 15 },
  status: { position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 4, background: "rgba(20, 20, 20, .78)", fontSize: 15 },
  notice: {
    position: "absolute", left: "50%", bottom: 62, transform: "translateX(-50%)",
    zIndex: 5, maxWidth: "88%", padding: "7px 14px", borderRadius: 999,
    border: `0.5px solid ${HAIRLINE}`, background: GLASS,
    WebkitBackdropFilter: "blur(20px) saturate(180%)", backdropFilter: "blur(20px) saturate(180%)",
    color: dark.foreground, fontSize: 12.5, fontWeight: 500, textAlign: "center",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },
  bar: {
    position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)",
    zIndex: 5, display: "flex", alignItems: "center", gap: 2, padding: 4,
    borderRadius: 999, border: `0.5px solid ${HAIRLINE}`, background: GLASS,
    WebkitBackdropFilter: "blur(20px) saturate(180%)", backdropFilter: "blur(20px) saturate(180%)",
    boxShadow: "0 8px 28px rgba(0, 0, 0, 0.45)",
  },
  controlOff: {
    display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px",
    border: 0, borderRadius: 999, background: "transparent", color: dark.foreground,
    fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
  },
  controlOn: {
    display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px",
    border: 0, borderRadius: 999, background: dark.primary, color: dark.primaryForeground,
    fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
  },
  divider: { width: 0.5, height: 20, margin: "0 3px", background: HAIRLINE },
  icon: {
    display: "grid", placeItems: "center", width: 34, height: 34, padding: 0,
    border: 0, borderRadius: 999, background: "transparent", color: dark.foreground, cursor: "pointer",
  },
  iconOn: {
    display: "grid", placeItems: "center", width: 34, height: 34, padding: 0,
    border: 0, borderRadius: 999, background: FILL, color: dark.foreground, cursor: "pointer",
  },
  keyRow: {
    display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
    borderTop: `0.5px solid ${HAIRLINE}`, background: "rgba(22, 22, 24, 0.96)",
  },
  keyScroller: { display: "flex", flex: 1, minWidth: 0, gap: 6, overflowX: "auto", scrollbarWidth: "none" },
  key: {
    flex: "1 0 auto", minWidth: 38, height: 32, padding: "0 8px", border: 0, borderRadius: 8,
    background: FILL, color: dark.foreground, fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  keyOn: {
    flex: "1 0 auto", minWidth: 38, height: 32, padding: "0 8px", border: 0, borderRadius: 8,
    background: dark.primary, color: dark.primaryForeground, fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  hide: {
    flex: "0 0 auto", width: 38, height: 32, padding: 0, border: 0, borderRadius: 8,
    background: FILL, color: dark.foreground, fontSize: 15, fontWeight: 700, lineHeight: "16px", cursor: "pointer",
  },
  /** Invisible, but on screen and focusable: an off-screen field makes WebKit
   *  scroll the page to find the caret. */
  field: {
    position: "absolute", left: "50%", bottom: 0, width: 1, height: 1,
    padding: 0, border: 0, outline: "none", resize: "none", opacity: 0,
    background: "transparent", color: "transparent", caretColor: "transparent",
    fontSize: 16, overflow: "hidden",
  },
};
