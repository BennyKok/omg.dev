import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { BtwDrawer } = await import("./btw-drawer");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => {
  ui.cleanup();
});

describe("BtwDrawer", () => {
  test("renders nothing when closed", () => {
    ui.render(
      <BtwDrawer
        open={false}
        desktop={true}
        turns={[]}
        streaming={false}
        onAsk={() => {}}
        onClear={() => {}}
        onClose={() => {}}
        onPromoteToMain={() => {}}
      />,
    );
    expect(ui.query("[data-btw-drawer]")).toBeNull();
  });

  test("renders empty state and promotes completed answer to main chat", () => {
    const onPromote = mock(() => {});
    const onClose = mock(() => {});
    ui.render(
      <BtwDrawer
        open={true}
        desktop={true}
        turns={[
          {
            id: "t1",
            question: "Why does sendq probe?",
            answer: "It confirms the user turn surfaced.",
            streaming: false,
          },
        ]}
        streaming={false}
        onAsk={() => {}}
        onClear={() => {}}
        onClose={onClose}
        onPromoteToMain={onPromote}
      />,
    );

    expect(ui.text()).toContain("Not saved to session");
    expect(ui.text()).toContain("Reads main transcript · Tools off");
    expect(ui.text()).toContain("Why does sendq probe?");
    expect(ui.text()).toContain("It confirms the user turn surfaced.");

    const buttons = Array.from(ui.host.querySelectorAll("button"));
    const sendToMain = buttons.find((b) => b.textContent?.includes("Send to main chat"));
    expect(sendToMain).toBeTruthy();
    sendToMain!.click();
    expect(onPromote).toHaveBeenCalledTimes(1);

    const closeBtn = ui.query('button[aria-label="Close side question"]') as HTMLButtonElement | null;
    expect(closeBtn).toBeTruthy();
    closeBtn!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
