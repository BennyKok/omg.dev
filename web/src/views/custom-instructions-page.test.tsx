// The Settings row and the page it opens. Rendered, not read as source, per
// AGENTS.md.
//
// The behavior worth pinning is the save discipline: this writes to sqlite
// through POST /api/settings, so it saves on an explicit action rather than per
// keystroke, and an unsaved edit must survive the bootstrap refresh that
// re-sends the stored value.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { mount, window, type Mounted } from "../test-support/render";

const { CustomInstructionsPage, CustomInstructionsRow, CUSTOM_INSTRUCTIONS_MAX_LENGTH } =
  await import("./custom-instructions-page");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const textarea = () => ui.query("textarea") as HTMLTextAreaElement;
const saveButton = () =>
  ui.queryAll("button").find((b) => (b.textContent ?? "").includes("Sav")) as HTMLButtonElement;

// React tracks the last value it wrote to a controlled field and ignores an
// input event whose value it believes it already knows. Assigning `.value`
// directly goes through React's own patched setter and updates that tracker, so
// the event is swallowed. The prototype setter is what makes a real keystroke.
const nativeValue = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype,
  "value",
)?.set;

function type(text: string) {
  ui.flush(() => {
    const field = textarea();
    nativeValue?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CustomInstructionsRow", () => {
  test("previews the first line of what is stored", () => {
    ui.render(
      <CustomInstructionsRow value={"Ask before you push.\nRun the tests."} onOpen={() => {}} />,
    );
    expect(ui.text()).toContain("Custom instructions");
    expect(ui.text()).toContain("Ask before you push.");
    // One line only. The rest belongs on the page.
    expect(ui.text()).not.toContain("Run the tests.");
  });

  test("says so when nothing is set", () => {
    ui.render(<CustomInstructionsRow value="" onOpen={() => {}} />);
    expect(ui.text()).toContain("Not set");
  });

  test("opens the page when tapped", () => {
    let opened = 0;
    ui.render(<CustomInstructionsRow value="" onOpen={() => opened++} />);
    ui.flush(() => (ui.query("button") as HTMLElement).click());
    expect(opened).toBe(1);
  });
});

describe("CustomInstructionsPage", () => {
  test("shows the stored instructions", () => {
    ui.render(<CustomInstructionsPage value="Ask before you push." onChange={async () => {}} />);
    expect(textarea().value).toBe("Ask before you push.");
  });

  test("does not save per keystroke — Save is the only writer", () => {
    const saves: string[] = [];
    ui.render(
      <CustomInstructionsPage
        value=""
        onChange={async (next) => {
          saves.push(next);
        }}
      />,
    );
    type("Run the tests.");
    expect(saves).toEqual([]);
  });

  test("Save is disabled until the text actually changes", () => {
    ui.render(<CustomInstructionsPage value="Ask first." onChange={async () => {}} />);
    expect(saveButton().disabled).toBe(true);
    type("Ask first, then push.");
    expect(saveButton().disabled).toBe(false);
  });

  test("saves the trimmed text once and confirms", async () => {
    const saves: string[] = [];
    ui.render(
      <CustomInstructionsPage
        value=""
        onChange={async (next) => {
          saves.push(next);
        }}
      />,
    );
    type("  Run the tests.  ");
    await ui.flushAsync(() => saveButton().click());

    expect(saves).toEqual(["Run the tests."]);
    expect(ui.text()).toContain("Saved.");
    expect(saveButton().disabled).toBe(true);
  });

  test("clearing the field saves an empty value instead of being read as untouched", async () => {
    const saves: string[] = [];
    ui.render(
      <CustomInstructionsPage
        value="Ask before you push."
        onChange={async (next) => {
          saves.push(next);
        }}
      />,
    );
    type("");
    expect(saveButton().disabled).toBe(false);
    await ui.flushAsync(() => saveButton().click());
    expect(saves).toEqual([""]);
  });

  test("a failed save reports the reason and keeps the text for a retry", async () => {
    ui.render(
      <CustomInstructionsPage
        value=""
        onChange={async () => {
          throw new Error("customInstructions must be a string of 4000 characters or fewer");
        }}
      />,
    );
    type("Run the tests.");
    await ui.flushAsync(() => saveButton().click());

    expect(ui.text()).toContain("4000 characters or fewer");
    expect(textarea().value).toBe("Run the tests.");
    expect(saveButton().disabled).toBe(false);
  });

  test("a bootstrap refresh does not overwrite an edit in progress", () => {
    ui.render(<CustomInstructionsPage value="Old rules." onChange={async () => {}} />);
    type("My new rules.");
    // Same component, new prop: what a /api/bootstrap poll does on reconnect.
    ui.render(<CustomInstructionsPage value="Old rules." onChange={async () => {}} />);
    expect(textarea().value).toBe("My new rules.");
  });

  test("an untouched field follows a value changed in another tab", () => {
    ui.render(<CustomInstructionsPage value="Old rules." onChange={async () => {}} />);
    ui.render(<CustomInstructionsPage value="Rules from elsewhere." onChange={async () => {}} />);
    expect(textarea().value).toBe("Rules from elsewhere.");
  });

  test("bounds the field to the server's limit rather than failing the save", () => {
    ui.render(<CustomInstructionsPage value="" onChange={async () => {}} />);
    expect(textarea().maxLength).toBe(CUSTOM_INSTRUCTIONS_MAX_LENGTH);
  });
});
