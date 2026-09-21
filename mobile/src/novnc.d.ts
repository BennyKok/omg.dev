declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | object, options?: { shared?: boolean });
    viewOnly: boolean;
    scaleViewport: boolean;
    showDotCursor: boolean;
    background: string;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    clipboardPasteFrom(text: string): void;
    disconnect(): void;
  }
}
