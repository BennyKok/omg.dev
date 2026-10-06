import { afterEach, describe, expect, test } from "bun:test";
import React, { useState } from "react";
import { mount, type Mounted, window } from "./test-support/render";

const { ComposerSendButton } = await import("./App");

let ui: Mounted;
afterEach(() => ui?.cleanup());

function dispatchPointer(button: HTMLButtonElement, type: "pointerdown" | "pointerup") {
  button.dispatchEvent(
    new window.PointerEvent(type, {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "touch",
    }),
  );
}

describe("ComposerSendButton", () => {
  test("keeps the send control mounted until the mobile click is dispatched", () => {
    ui = mount();
    let sends = 0;

    function Composer() {
      const [visible, setVisible] = useState(true);
      return visible ? (
        <ComposerSendButton
          sending={false}
          defaultMode="steer"
          onSend={() => {
            sends += 1;
            setVisible(false);
          }}
          onQueue={() => {}}
        />
      ) : (
        <button aria-label="Dictate" />
      );
    }

    ui.render(<Composer />);
    const send = ui.query('button[aria-label="Send — hold to queue"]') as HTMLButtonElement;

    ui.flush(() => {
      dispatchPointer(send, "pointerdown");
      dispatchPointer(send, "pointerup");
    });

    expect(sends).toBe(0);
    expect(ui.query('button[aria-label="Send — hold to queue"]')).toBe(send);

    ui.flush(() => send.click());

    expect(sends).toBe(1);
    expect(ui.query('button[aria-label="Dictate"]')).not.toBeNull();
  });
});
