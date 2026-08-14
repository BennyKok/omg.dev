/**
 * Fail if the native attachment parser has drifted from the web one.
 *
 * src/omg/message-attachments.ts is a hand-maintained port of
 * web/src/lib/message-attachments.ts, because mobile/ is not a workspace member
 * and cannot import from web/. A copy with no guard is a copy that silently
 * rots: someone changes the block format on the web, ships it, and the phone
 * keeps rendering raw upload paths with nothing anywhere reporting a problem.
 *
 * The comparison is BEHAVIOURAL, not textual. Comparing source would fail on a
 * reworded comment while passing a real semantic change made in both files at
 * once; running both parsers over the same inputs tests the only thing that
 * actually has to match. The cases are the ones the shared format can express,
 * including the ones the parser deliberately refuses.
 *
 * Run: bun run scripts/check-attachment-drift.ts
 */

import * as native from "../src/omg/message-attachments";

const WEB_PATH = new URL("../../web/src/lib/message-attachments.ts", import.meta.url).pathname;

if (!(await Bun.file(WEB_PATH).exists())) {
  console.error(`Could not read ${WEB_PATH} — is the web workspace present?`);
  process.exit(2);
}

const web = (await import(WEB_PATH)) as typeof native;

const UPLOAD = "/tmp/lfg-uploads/new-session-3effbb22-CleanShot.png";

/** Every shape the block can take, plus the ones the parser must leave alone. */
const CASES: string[] = [
  "",
  "just a sentence",
  `can you spot my user complains?\n\nAttached file:\n- CleanShot 2026-08-02 at 18.59.11.png: ${UPLOAD}`,
  `Attached files:\n- a.png: /tmp/lfg-uploads/s-a.png\n- b.png: /tmp/lfg-uploads/s-b.png\n`,
  "here\n\nAttached file:\n- notes.pdf: /tmp/lfg-uploads/s-notes.pdf",
  "look\n\nAttached file:\n- shot.png: /home/dev/secrets/shot.png",
  "Attached files: are broken, see the Attached file: note above",
  "hi\n\nAttached files:\n- a.png: /tmp/lfg-uploads/s-a.png\n- mystery line",
  `Attached file:\n- a.png: /tmp/lfg-uploads/s-a.png\n\nwhat is this?`,
  // A colon inside the display name still has to split on the path.
  "x\n\nAttached file:\n- weird: name.png: /tmp/lfg-uploads/s-weird.png",
  // Every displayable extension, and one that is not.
  "y\n\nAttached files:\n- a.jpg: /tmp/lfg-uploads/a.jpg\n- b.jpeg: /tmp/lfg-uploads/b.jpeg\n- c.webp: /tmp/lfg-uploads/c.webp\n- d.gif: /tmp/lfg-uploads/d.gif\n- e.txt: /tmp/lfg-uploads/e.txt",
  // Multi-paragraph body: only the trailing block goes.
  `line one\n\nline two\n\nAttached file:\n- a.png: /tmp/lfg-uploads/s-a.png`,
];

const PATHS: string[] = [
  "/tmp/lfg-uploads/a b.png",
  "/tmp/lfg-uploads/a.PNG",
  "/tmp/lfg-uploads/noext",
  "/etc/passwd.png",
  "/tmp/lfg-uploads/a.pdf",
];

const problems: string[] = [];
const show = (value: unknown) => JSON.stringify(value);

for (const input of CASES) {
  const a = native.parseMessageAttachments(input);
  const b = web.parseMessageAttachments(input);
  if (show(a) !== show(b)) {
    problems.push(
      `parseMessageAttachments(${show(input)})\n      native: ${show(a)}\n      web:    ${show(b)}`,
    );
  }
}

for (const path of PATHS) {
  if (native.isDisplayableAttachment(path) !== web.isDisplayableAttachment(path)) {
    problems.push(
      `isDisplayableAttachment(${show(path)}): native ${native.isDisplayableAttachment(path)}, web ${web.isDisplayableAttachment(path)}`,
    );
  }
  if (native.uploadRequestPath(path) !== web.uploadRequestPath(path)) {
    problems.push(
      `uploadRequestPath(${show(path)}): native ${show(native.uploadRequestPath(path))}, web ${show(web.uploadRequestPath(path))}`,
    );
  }
}

if (problems.length) {
  console.error(
    `\nAttachment parser drift — ${problems.length} case(s) no longer match web/src/lib/message-attachments.ts:\n`,
  );
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    "\nUpdate src/omg/message-attachments.ts to match the web parser. Both\n" +
      "surfaces render the same messages, so they must split them the same way.\n",
  );
  process.exit(1);
}

console.log(
  `Attachment parser in sync — ${CASES.length} message(s) and ${PATHS.length} path(s) match web/src/lib/message-attachments.ts.`,
);
