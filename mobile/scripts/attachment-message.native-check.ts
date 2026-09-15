/**
 * The block that carries attachments to the agent.
 *
 * This is a WIRE FORMAT, not a label. `composeAttachmentMessage` in
 * web/src/App.tsx writes the identical block and
 * web/src/lib/message-attachments.ts parses it back off for display, so a
 * one-character difference makes the same message render as a path on one
 * surface and a picture on the other. Two callers on this side now share it:
 * the composers, and the onboarding launch.
 */
import { expect, test } from "bun:test";
import { composeAttachmentMessage } from "../src/omg/attachment-message";

test("no attachments leaves the text exactly as written", () => {
  expect(composeAttachmentMessage("Fix the widget", [])).toBe("Fix the widget");
});

test("one attachment is singular, and sits under a blank line", () => {
  expect(composeAttachmentMessage("Look at this", [{ name: "IMG_0850.png", path: "/tmp/u/IMG_0850.png" }]))
    .toBe("Look at this\n\nAttached file:\n- IMG_0850.png: /tmp/u/IMG_0850.png");
});

test("more than one is plural, one per line", () => {
  expect(
    composeAttachmentMessage("Compare", [
      { name: "a.png", path: "/tmp/u/a.png" },
      { name: "b.png", path: "/tmp/u/b.png" },
    ]),
  ).toBe("Compare\n\nAttached files:\n- a.png: /tmp/u/a.png\n- b.png: /tmp/u/b.png");
});

/**
 * The onboarding "own idea" path can reach sign-in with files and no words.
 * An empty first line would push the block down and read as a blank message.
 */
test("attachments with no text do not leave a leading blank line", () => {
  expect(composeAttachmentMessage("", [{ name: "brief.pdf", path: "/tmp/u/brief.pdf" }]))
    .toBe("Attached file:\n- brief.pdf: /tmp/u/brief.pdf");
});
