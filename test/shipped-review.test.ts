import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("shipped session review flow", () => {
  const app = readFileSync("web/src/App.tsx", "utf8");

  test("shipped shortcuts open inside the live workspace without resuming", () => {
    expect(app).toContain(
      "onReviewSession={openShippedSession}",
    );
    expect(app).toContain("shippedReview={shippedReview}");
    expect(app).toContain('setTab("live")');
    expect(app).not.toContain("function ShipTranscriptSheet(");
    expect(app).not.toContain('toast.message("Resuming shipped session…")');
  });

  // A shipped session under review opens through the SAME surfaces as any
  // other session — the mobile page and the desktop stage — rather than a
  // bespoke read-only viewer. `sheet.sid` became `openSessionId` when the
  // mobile session view moved to its own URL; the rule is unchanged.
  test("desktop and mobile use the normal session surfaces", () => {
    expect(app).toContain(
      "shippedReview?.sessionId === openSessionId ? shippedReview : null",
    );
    expect(app).toContain(
      "return { sid: sourceSid, session: shippedReview };",
    );
  });

  // The "Recently shipped" category was removed from the Live view on both
  // surfaces. Reviewing a shipped session still works, but it is reached from
  // the Shipped feed rather than from a category in the live sidebar/rail.
  test("the live view no longer carries a recently shipped category", () => {
    expect(app).not.toContain("useRecentShippedSessions(");
    expect(app).not.toContain('data-recent-shipped="true"');
    expect(app).not.toContain('label="Recently shipped"');
    expect(app).not.toContain("function RecentShippedRow(");
    expect(app).not.toContain("onOpenRecentShipped");
  });

  test("mobile session headers keep their compact row height", () => {
    expect(app).toContain(
      'className="flex min-h-[3.75rem] min-w-0 items-center gap-2 border-b border-border px-3 py-2"',
    );
  });

  test("the first new message is included in the resume request", () => {
    expect(app).toContain('await api<{ sessionId?: string }>("/api/sessions/resume"');
    expect(app).toContain("sessionId: sid,\n            prompt: outgoingText,");
    expect(app).toContain("Sending resumes this session.");
  });
});
