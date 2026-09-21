/** @jsxImportSource ../../web/node_modules/react */
/**
 * The Computer viewer's behaviour, rendered.
 *
 * The screen is a `use dom` component, so it is ordinary DOM React and can be
 * mounted in the shared harness. That matters: the thing worth proving here is
 * that a keystroke reaches RFB THE MOMENT IT ARRIVES, with no Send button in
 * the way, and no source-text assertion can tell that apart from a field that
 * merely exists.
 *
 * noVNC is replaced with a recorder that keeps the parts this screen actually
 * uses: `viewOnly`, `sendKey`, and a canvas in the host element for the
 * synthesised pointer events to land on.
 */
import { mount, window as domWindow, type Mounted } from '../../web/src/test-support/render';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import * as React from '../../web/node_modules/react';
import { resolve } from 'node:path';

mock.module(resolve(import.meta.dir, '../node_modules/react/index.js'), () => React);

// The harness installs the globals React needs. The viewer synthesises pointer
// events itself, so it needs the constructor for them too.
Object.assign(globalThis, { MouseEvent: (domWindow as unknown as { MouseEvent: unknown }).MouseEvent });

type SentKey = { keysym: number; code: string | null; down: boolean };

class FakeRFB {
  static last: FakeRFB | null = null;
  viewOnly = false;
  scaleViewport = false;
  showDotCursor = false;
  background = '';
  sent: SentKey[] = [];
  pasted: string[] = [];
  canvas: HTMLCanvasElement;
  mouse: { type: string; button: number; buttons: number }[] = [];
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(target: HTMLElement) {
    // noVNC puts a canvas in the host element and reads pointer events off it.
    this.canvas = target.ownerDocument.createElement('canvas');
    for (const type of ['mousemove', 'mousedown', 'mouseup']) {
      this.canvas.addEventListener(type, (event) => {
        const mouseEvent = event as MouseEvent;
        this.mouse.push({ type, button: mouseEvent.button, buttons: mouseEvent.buttons });
      });
    }
    // noVNC installs a window-level capture proxy on press, and the viewer
    // sends the RELEASE there on purpose so the proxy can clean it up. Listen
    // where the release actually goes, or a click looks like half a click.
    target.ownerDocument.defaultView!.addEventListener('mouseup', (event) => {
      if (FakeRFB.last !== this) return;
      const mouseEvent = event as MouseEvent;
      this.mouse.push({ type: 'mouseup', button: mouseEvent.button, buttons: mouseEvent.buttons });
    });
    target.appendChild(this.canvas);
    FakeRFB.last = this;
  }

  addEventListener(name: string, handler: (event: unknown) => void) {
    (this.listeners[name] ??= []).push(handler);
  }

  emit(name: string) {
    for (const handler of this.listeners[name] ?? []) handler({});
  }

  sendKey(keysym: number, code: string | null, down: boolean) {
    if (this.viewOnly) return;
    this.sent.push({ keysym, code, down });
  }

  clipboardPasteFrom(text: string) {
    this.pasted.push(text);
  }

  disconnect() {}
}

mock.module(resolve(import.meta.dir, '../node_modules/@novnc/novnc/lib/rfb.js'), () => ({
  default: FakeRFB,
}));
mock.module('@novnc/novnc', () => ({ default: FakeRFB }));

// The component opens a socket before handing it to RFB. Nothing reads it here.
class FakeSocket {
  binaryType = '';
  constructor(public url: string, public protocols?: string[]) {}
  close() {}
  addEventListener() {}
}
(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;

const { default: ComputerControlDom } = await import('../src/omg/computer-control-dom');

const SOCKET = { socketUrl: 'wss://box.example/api/computer', protocol: 'omg' };

let ui: Mounted;

/** Mount the viewer and report it live, the state everything else starts from. */
function open(props: Record<string, unknown> = {}): FakeRFB {
  ui.render(<ComputerControlDom {...SOCKET} {...props} />);
  const rfb = FakeRFB.last!;
  ui.flush(() => rfb.emit('connect'));
  return rfb;
}

function button(label: string): HTMLButtonElement {
  const found = ui.query(`button[aria-label^="${label}"]`) as HTMLButtonElement | null;
  if (!found) throw new Error(`no button labelled ${label}: ${ui.text()}`);
  return found;
}

/** The control toggle, whichever of its two labels it is wearing. */
function controlToggle(): HTMLButtonElement {
  return ui.query('[data-testid="computer-take-control"]') as HTMLButtonElement;
}

function field(): HTMLTextAreaElement {
  return ui.query('textarea') as HTMLTextAreaElement;
}

/** Type into the focus field the way the iOS keyboard does: append, then fire
 *  `input`. The component reads the delta and empties the field itself. */
function type(text: string) {
  const target = field();
  ui.flush(() => {
    target.value += text;
    target.dispatchEvent(new (window as unknown as { InputEvent: typeof Event }).InputEvent('input', { bubbles: true }));
  });
}

/** Press the delete key: the field loses one character, then fires `input`. */
function backspace(times = 1) {
  const target = field();
  for (let index = 0; index < times; index += 1) {
    ui.flush(() => {
      target.value = target.value.slice(0, -1);
      target.dispatchEvent(new (window as unknown as { InputEvent: typeof Event }).InputEvent('input', { bubbles: true }));
    });
  }
}

function pressed(rfb: FakeRFB): number[] {
  return rfb.sent.filter((key) => key.down).map((key) => key.keysym);
}

beforeEach(() => {
  ui = mount();
  FakeRFB.last = null;
});
afterEach(() => ui.cleanup());

test('there is no compose field and no Send button', () => {
  open();
  // The only textarea on the screen is the invisible focus field, and it is
  // labelled as the keyboard rather than as somewhere to draft a message.
  expect(ui.queryAll('textarea')).toHaveLength(1);
  expect(field().getAttribute('aria-label')).toContain('goes to the Computer');
  expect(ui.text()).not.toContain('Send');
  expect(ui.text()).not.toContain('Type or paste text');
});

test('the screen is view only until you take control', () => {
  const rfb = open();
  expect(rfb.viewOnly).toBe(true);
  expect(ui.text()).toContain('Take control');

  ui.flush(() => controlToggle().click());
  expect(rfb.viewOnly).toBe(false);
  expect(ui.text()).toContain('Controlling');
});

test('a key typed while view only never reaches the desktop', () => {
  const rfb = open();
  type('a');
  expect(rfb.sent).toHaveLength(0);
});

test('each key goes to the desktop as it is typed, with nothing to press', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());

  type('h');
  expect(pressed(rfb)).toEqual([0x68]);
  type('i');
  expect(pressed(rfb)).toEqual([0x68, 0x69]);
  // Press and release for each, in order.
  expect(rfb.sent.map((key) => key.down)).toEqual([true, false, true, false]);
  // And the field never keeps what was typed.
  expect(field().value).not.toContain('h');
});

test('the keyboard button takes control on its own', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());
  expect(rfb.viewOnly).toBe(false);
});

test('a character outside Latin-1 uses the Unicode keysym plane', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());
  type('€');
  expect(pressed(rfb)).toEqual([0x01000000 + 0x20ac]);
});

test('Return arrives as Enter, not as a newline character', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());
  type('\n');
  expect(pressed(rfb)).toEqual([0xff0d]);
});

test('delete sends Backspace even though the field shows nothing', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());
  backspace();
  expect(pressed(rfb)).toEqual([0xff08]);
});

test('a held delete repeats, and the hidden pad is topped up before it runs out', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());
  const padded = field().value.length;
  expect(padded).toBeGreaterThan(100);

  backspace(140);
  expect(pressed(rfb).filter((keysym) => keysym === 0xff08)).toHaveLength(140);
  // Still plenty left to delete, so the next repeat is reported too.
  expect(field().value.length).toBeGreaterThan(20);
  backspace();
  expect(pressed(rfb).filter((keysym) => keysym === 0xff08)).toHaveLength(141);
});

test('arrow keys from a hardware keyboard reach the desktop', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());
  ui.flush(() => {
    field().dispatchEvent(new (window as unknown as { KeyboardEvent: typeof Event }).KeyboardEvent(
      'keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true, cancelable: true },
    ));
  });
  expect(pressed(rfb)).toEqual([0xff51]);
});

test('esc and tab are on the key row, which only exists while typing', () => {
  const rfb = open();
  expect(ui.query('button[aria-label="esc"]')).toBeNull();

  ui.flush(() => button('Show keyboard').click());
  ui.flush(() => button('esc').click());
  ui.flush(() => button('tab').click());
  expect(pressed(rfb)).toEqual([0xff1b, 0xff09]);
});

test('a key acts on the press, and a following click does not send it twice', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());
  const escape = button('esc');

  // WebKit swallows the click after a touch on these buttons, because
  // cancelling the pointer default is what keeps the keyboard up. The press
  // is therefore the action, and the click that may or may not follow it must
  // not send the key a second time.
  ui.flush(() => {
    escape.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event(
      'pointerdown', { bubbles: true, cancelable: true },
    ));
    escape.click();
  });
  expect(pressed(rfb)).toEqual([0xff1b]);
});

test('ctrl latches for exactly one key, so ctrl+c reaches a terminal', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());
  ui.flush(() => button('ctrl').click());
  expect(button('ctrl').getAttribute('aria-pressed')).toBe('true');

  type('c');
  expect(rfb.sent).toEqual([
    { keysym: 0xffe3, code: 'ControlLeft', down: true },
    { keysym: 0x63, code: null, down: true },
    { keysym: 0x63, code: null, down: false },
    { keysym: 0xffe3, code: 'ControlLeft', down: false },
  ]);

  // Latched, not held: the next key is plain.
  expect(button('ctrl').getAttribute('aria-pressed')).toBe('false');
  type('c');
  expect(rfb.sent).toHaveLength(6);
});

test('right click works before the pointer has ever been dragged', () => {
  const rfb = open();
  ui.flush(() => button('Right click').click());
  expect(rfb.mouse.map((event) => `${event.type}:${event.button}`))
    .toEqual(['mousedown:2', 'mouseup:2']);
  expect(rfb.viewOnly).toBe(false);
});

test('releasing control closes the keyboard and stops every key', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());
  expect(ui.query('button[aria-label="esc"]')).toBeTruthy();

  ui.flush(() => controlToggle().click());
  expect(rfb.viewOnly).toBe(true);
  expect(ui.query('button[aria-label="esc"]')).toBeNull();
  type('a');
  expect(rfb.sent).toHaveLength(0);
});

test('the focus field is offered to a screen reader only while it is in use', () => {
  open();
  // One point tall at the bottom edge: while the keyboard is down this is a
  // control nobody can hit, so it must not be offered as one. The Keyboard
  // button is the way in.
  expect(field().getAttribute('aria-hidden')).toBe('true');

  ui.flush(() => button('Show keyboard').click());
  expect(field().getAttribute('aria-hidden')).toBeNull();
});

test('the keyboard can be dismissed without giving up control', () => {
  const rfb = open();
  ui.flush(() => button('Show keyboard').click());
  ui.flush(() => button('Hide keyboard').click());
  expect(ui.query('button[aria-label="esc"]')).toBeNull();
  expect(rfb.viewOnly).toBe(false);
  expect(ui.text()).toContain('Controlling');
});

test('the screen gives up exactly the height the keyboard covers', () => {
  open({ keyboardInset: 336 });
  const root = ui.query('[data-testid="computer-control-viewer"]') as HTMLElement;
  // Nothing is focused yet, so the keyboard is not up and the screen is whole.
  expect(root.getAttribute('data-keyboard-inset')).toBe('0');

  ui.flush(() => button('Show keyboard').click());
  expect(root.getAttribute('data-keyboard-inset')).toBe('336');

  ui.flush(() => button('Hide keyboard').click());
  expect(root.getAttribute('data-keyboard-inset')).toBe('0');
});
