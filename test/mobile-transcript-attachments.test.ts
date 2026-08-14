import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  isDisplayableAttachment,
  parseMessageAttachments,
  uploadRequestPath,
} from "../mobile/src/omg/message-attachments";
import {
  parseMessageAttachments as parseOnWeb,
} from "../web/src/lib/message-attachments";

const UPLOAD = "/tmp/lfg-uploads/new-session-3effbb22-4b4b-49a6-IMG_0850.png";

describe("the phone splits attachments off a user message", () => {
  test("lifts the trailing block out and keeps what the user typed", () => {
    const parsed = parseMessageAttachments(
      `what is wrong with this screen?\n\nAttached file:\n- IMG_0850.png: ${UPLOAD}`,
    );
    expect(parsed.body).toBe("what is wrong with this screen?");
    expect(parsed.attachments).toEqual([
      { name: "IMG_0850.png", path: UPLOAD, url: "/api/uploads/new-session-3effbb22-4b4b-49a6-IMG_0850.png" },
    ]);
  });

  test("an image with no caption leaves an empty body, so no bubble is drawn", () => {
    const parsed = parseMessageAttachments(`Attached file:\n- a.png: /tmp/lfg-uploads/s-a.png`);
    expect(parsed.body).toBe("");
    expect(parsed.attachments).toHaveLength(1);
  });

  test("a file it cannot draw is listed but carries no url, so it shows as a chip", () => {
    const parsed = parseMessageAttachments(
      "read this\n\nAttached file:\n- notes.pdf: /tmp/lfg-uploads/s-notes.pdf",
    );
    expect(parsed.attachments[0]!.url).toBeNull();
    expect(isDisplayableAttachment("/tmp/lfg-uploads/s-notes.pdf")).toBe(false);
  });

  test("a path outside the uploads dir is never requested", () => {
    const parsed = parseMessageAttachments(
      "look\n\nAttached file:\n- shot.png: /home/dev/secrets/shot.png",
    );
    expect(parsed.attachments[0]!.url).toBeNull();
  });

  test("prose that merely mentions attachments is left alone", () => {
    const text = "Attached files: are broken, see the Attached file: note above";
    expect(parseMessageAttachments(text)).toEqual({ body: text, attachments: [] });
  });

  test("a block it cannot fully account for stays as text rather than losing a line", () => {
    const text = "hi\n\nAttached files:\n- a.png: /tmp/lfg-uploads/s-a.png\n- mystery line";
    expect(parseMessageAttachments(text)).toEqual({ body: text, attachments: [] });
  });

  test("the basename is url-encoded, because upload names contain spaces", () => {
    expect(uploadRequestPath("/tmp/lfg-uploads/a b.png")).toBe("/api/uploads/a%20b.png");
  });
});

describe("the phone and the web split the same message the same way", () => {
  // The two files are separate because mobile/ is not a workspace member. This
  // is the guard that they stay one behaviour; check-attachment-drift.ts runs
  // the same comparison from inside mobile/.
  const CASES = [
    "",
    "no attachments here",
    `caption\n\nAttached file:\n- a.png: ${UPLOAD}`,
    `Attached files:\n- a.png: /tmp/lfg-uploads/s-a.png\n- b.jpeg: /tmp/lfg-uploads/s-b.jpeg\n`,
    "here\n\nAttached file:\n- notes.pdf: /tmp/lfg-uploads/s-notes.pdf",
    "Attached files: are broken, see the Attached file: note above",
    "hi\n\nAttached files:\n- a.png: /tmp/lfg-uploads/s-a.png\n- mystery line",
    `Attached file:\n- a.png: /tmp/lfg-uploads/s-a.png\n\nwhat is this?`,
  ];

  for (const input of CASES) {
    test(`matches the web for ${JSON.stringify(input.slice(0, 40))}`, () => {
      expect(parseMessageAttachments(input)).toEqual(parseOnWeb(input));
    });
  }
});

describe("the transcript renders a user turn the way the web does", () => {
  const transcript = readFileSync("mobile/src/omg/transcript.tsx", "utf8");
  const userMessage = transcript.slice(
    transcript.indexOf("export function UserMessage("),
    transcript.indexOf("function UserAttachments("),
  );

  test("the bubble paints the split body, never the raw message text", () => {
    expect(userMessage).toContain("parseMessageAttachments(message.text");
    expect(userMessage).toContain("{text}");
    expect(userMessage).not.toContain("{message.text}");
  });

  test("a sent message reads at the same size and rhythm as the reply", () => {
    // Both roles resolve to the one body style, as they do on the web via
    // `.msg-text.markdown`. A local lineHeight here would mean drift.
    expect(userMessage).toContain("useBodyText()");
    expect(userMessage).not.toMatch(/lineHeight:\s*2[0-9]/);
  });

  test("copy still yields the raw text the agent received", () => {
    expect(userMessage).toContain("Clipboard.setStringAsync(message.text)");
  });

  test("an attachment with no caption draws no empty bubble", () => {
    expect(userMessage).toMatch(/\{text \? \(/);
  });

  test("attachments sit above the bubble, not inside it", () => {
    expect(userMessage.indexOf("<UserAttachments")).toBeLessThan(
      userMessage.indexOf("{text ? ("),
    );
  });

  test("only the user's turn is a card; the assistant's reply is plain text", () => {
    const assistant = transcript.slice(
      transcript.indexOf("// The assistant's reply is plain text"),
      transcript.indexOf("/* ---", transcript.indexOf("// The assistant's reply is plain text")),
    );
    expect(assistant).toContain("<Markdown");
    expect(assistant).not.toContain("backgroundColor: colors.card");
  });
});
