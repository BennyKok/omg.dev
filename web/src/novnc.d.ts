// @novnc/novnc ships no type declarations. Declare only the surface the
// Computer view uses, rather than pulling in a community types package for a
// handful of members.
declare module "@novnc/novnc" {
  export interface RFBOptions {
    shared?: boolean;
    credentials?: { username?: string; password?: string; target?: string };
    wsProtocols?: string[];
  }
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | object, options?: RFBOptions);
    /** Send input to the server. False makes the view read-only. */
    viewOnly: boolean;
    /** Scale the framebuffer to fit the container element. */
    scaleViewport: boolean;
    /** Ask the server to resize the desktop to match the container. */
    resizeSession: boolean;
    /** Draw a dot where the remote cursor is when it has no visible shape. */
    showDotCursor: boolean;
    /** Send one key to the remote. keysym per X11; code is a DOM code. */
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    background: string;
    focusOnClick: boolean;
    disconnect(): void;
    focus(): void;
    blur(): void;
  }
}
