import { describe, expect, test } from "bun:test";
import { classifySystemMessage as phone } from "../mobile/src/omg/system-message";
import { classifySystemMessage as web } from "../web/src/lib/system-message";

const samples = [
  "Fix the login bug",
  "",
  "[1] first item",
  "[Background task ios app · 542a7801]\n\nExact shipping tip is 0964f06ea.",
  "[Background task cde6c958]\n\ndone",
  "[subagent complete] rebased onto main",
  "[subagent progress] halfway",
  "[subagent blocked] need a token",
  "[subagent failed] tests red",
  "[Peer message from Scout (bot_1a2b3c4d5e) to Angel (bot_9f8e7d6c5b)]\n\nnice try",
  "[Message from itechbenny@gmail.com to bot iOS Manager] try again",
  "[ask-user answer 4f2a9c1e-1111-2222-3333-444444444444] Their reply: ship it\n",
  "[Browser login 841fe13e-e60a-43e4-9cf5-8338179ae574] The user approved a login transfer for https://accounts.hetzner.com to the shared Computer browser. Cookies were imported. Verify the protected page with Computer tools before continuing; imported cookies alone do not prove authentication.",
  "[Browser login abc] The user approved a login transfer.",
  [
    "You are starting a fresh agent session from an existing lfg session.",
    "",
    "This is NOT a resume. Treat the source transcript as read-only context, then follow the user's extra prompt below.",
    "",
    "Source session id: 542a7801-118e-4740-a8df-eb9b1ded1fd5",
    "Source title: Show coding agent icons",
    "Source cwd: /home/dev/lfg-worktrees/lfg-e7a545",
    "Source transcript JSONL: /tmp/x.jsonl",
    "",
    "Read the transcript file directly before acting.",
    "",
    "User's extra prompt:",
    "Finish the picker.",
  ].join("\n"),
  "[This conversation continues with your updated configuration. Earlier history is preserved and searchable.]",
  "[This conversation continues after a runtime restart. Earlier history is preserved and searchable.]",
  "[This conversation continues in a fresh context window. Earlier history is preserved and searchable.]",
  "[Scheduled routine: Morning check]\n\nLook at CI.",
];

describe("web and iOS classify the same machine-written turns", () => {
  test("every known wrapper agrees", () => {
    for (const sample of samples) {
      expect(web(sample), sample).toEqual(phone(sample));
    }
  });
});
