// The Notification Center absorbed the Ask page: agent questions are a form of
// notification, so they are answered in the feed instead of on a page of their
// own. These are structural guards — the surfaces live in a 20k-line component,
// so the cheap thing to pin is that the wiring exists and the retired pieces
// are actually gone rather than merely unreachable.
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

// The shipped feed and the notification surface moved into their own lazily
// loaded chunk (web/src/views/shipped-page.tsx); these assertions follow the
// code rather than the file it used to live in.
const app = async () =>
  (await readFile("web/src/App.tsx", "utf8")) +
  (await readFile("web/src/views/shipped-page.tsx", "utf8"));
const askCenter = () => readFile("web/src/components/ask-center.tsx", "utf8");

describe("questions live inside the Notification Center", () => {
  test("the feed renders questions as answerable cells", async () => {
    const source = await app();
    expect(source).toContain(
      "<QuestionNotification key={q.id} q={q} onOpenSession={onOpenSession} />",
    );
    // Read from the app-wide provider, not fetched a second time by the page.
    expect(source).toContain("} = useAsk();");
    expect(source).not.toContain("/api/ask?status=open");
    expect(source).toContain("Needs you");
  });

  test("question clicks open the owning session while More expands the reply", async () => {
    const source = await app();
    const center = await askCenter();
    expect(source).toContain(
      "<QuestionNotification key={q.id} q={q} onOpenSession={onOpenSession} />",
    );
    expect(center).toContain("if (q.sessionId && onOpenSession) onOpenSession(q.sessionId);");
    expect(center).toContain('title={q.sessionId ? "Open corresponding session" : "Show full question"}');
    expect(center).toContain("              More\n");
    expect(center).not.toContain("Show more");
  });

  test("the owning session renders its ask-user questions in place", async () => {
    const source = await app();
    const center = await askCenter();
    expect(source).toContain(
      "<SessionQuestionPanel sessionIds={[session.sessionId, session.nativeSessionId]} />",
    );
    expect(center).toContain("export function SessionQuestionPanel({");
    expect(center).toContain("aliases.has(q.sessionId)");
    expect(center).toContain(
      "<QuestionNotification key={q.id} q={q} compactPreview={false} showReplyBox={false} />",
    );
    // Suggested answers stay in the card: one tap is not a second input.
    expect(center).toContain("onClick={() => void answer(q, o)}");
    // One matcher decides which questions belong to a session, so the panel,
    // the composer, and the live card cannot disagree.
    expect(center).toContain("export function useSessionQuestions(");
  });

  // The bug: a question inside its own conversation drew a reply box directly
  // on top of the session composer. Two identical inputs, no way to tell which
  // one the agent hears.
  test("a question inside its session has no reply box of its own", async () => {
    const source = await app();
    const center = await askCenter();
    // The card's textarea exists for the Notification Center only.
    expect(center).toContain("{open && showReplyBox ? (");
    expect(center).toContain("showReplyBox = true,");
    expect(center).toContain("showReplyBox?: boolean;");
    // The session composer says it is the reply box for the open question.
    expect(source).toContain('? "Reply to the question"');
  });

  test("sending in the composer answers the question without a second delivery", async () => {
    const source = await app();
    const center = await askCenter();
    const serve = await readFile("src/commands/serve.ts", "utf8");
    // The composer resolves every question this session raised.
    expect(source).toContain("const { answerInSession } = useAsk();");
    expect(source).toContain("for (const q of sessionQuestions) void answerInSession(q, text);");
    // answerInSession records the answer but asks the server NOT to inject it:
    // the same text is already going to the agent through the normal send.
    expect(center).toContain('via: "web", deliver: false');
    expect(serve).toContain("if (b.deliver === false) {");
    expect(serve).toContain("await markHandled(q.id);");
  });

  test("a session waiting on an answer is marked in the live view", async () => {
    const source = await app();
    expect(source).toContain(
      "const pendingQuestions = useSessionQuestions([session.sessionId, session.nativeSessionId]);",
    );
    expect(source).toContain("const needsYou = pendingQuestions.length > 0;");
    // Card border plus a header badge, so the blocked session is visible in a
    // grid of running ones without opening it.
    expect(source).toContain("            : needsYou");
    expect(source).toContain("            Needs you");
  });

  test("a question in the Notification Center always opens its session", async () => {
    const center = await askCenter();
    // Collapsed: the preview line and the title both navigate.
    expect(center).toContain("if (q.sessionId && onOpenSession) onOpenSession(q.sessionId);");
    // Expanded: the preview is gone, so an explicit action carries the link.
    expect(center).toContain("              Open session");
    expect(center.match(/onOpenSession\(q\.sessionId as string\)/g)?.length).toBe(2);
  });

  test("a question can always be dismissed, on any device", async () => {
    const center = await askCenter();
    const dismissButton = center.slice(
      center.indexOf('aria-label="Dismiss question"'),
      center.indexOf('<X className="size-3.5" />'),
    );
    expect(dismissButton).toBeTruthy();
    // Regression: the control shipped hover-gated (`opacity-0` +
    // `group-hover:opacity-100` + `sm:opacity-0`), which the media-query rule
    // won on desktop and touch could never trigger at all — the only way out of
    // a question was answering it.
    expect(dismissButton).not.toContain("opacity-0");
    expect(dismissButton).not.toContain("group-hover");
    // Bulk escape hatch for a stacked backlog.
    expect(center).toContain("dismissAll");
    expect(await app()).toContain("Dismiss all");
  });

  test("resolving a question takes its sticky OS banner down", async () => {
    const center = await askCenter();
    // Ask notifications use requireInteraction, so they outlive the question
    // unless the page closes them by tag.
    expect(center).toContain("closePushNotification(`ask-${q.id}`)");
  });

  test("the ask page is gone, not just unlinked", async () => {
    const source = await app();
    const center = await askCenter();
    expect(source).not.toContain("<AskPage");
    expect(source).not.toContain('tab === "ask"');
    expect(center).not.toContain("export function AskPage");
    // The floating card and its collapse state were dead before this change.
    expect(center).not.toContain("export function AskCenter");
    expect(center).not.toContain("export function useAskCount");
    expect(center).not.toContain("setCollapsed");
  });

  test("the urgency badge opens the Notification Center", async () => {
    const source = await app();
    expect(source).toContain('onOpen={() => setTab("notifications")}');
  });
});

describe("the notification row is compact", () => {
  test("no follow-up button: forking belongs in the session", async () => {
    const source = await app();
    expect(source).not.toContain("setFollowingUp");
    expect(source).not.toContain("onFollowUpCreated");
    // The fork dialog's follow-up mode had exactly one caller — this button.
    expect(source).not.toContain('mode="follow-up"');
    expect(source).not.toContain('mode?: "fork" | "follow-up"');
    // The manage-sessions template ("Follow up commits/PRs") that used to be the
    // one legitimate surviving match was removed along with the rest of that
    // feature, so the phrase should not appear anywhere in the row's source now.
    expect(source).not.toMatch(/Follow up/);
  });

  test("media is a trailing thumbnail, not a full-width grid", async () => {
    const source = await app();
    expect(source).toContain("function ShipMediaThumb(");
    expect(source).toContain("post.mediaTotal ?? post.mediaItems.length");
    // The full-width per-post media renderer is retired.
    expect(source).not.toContain("function ShipMedia({");
  });

  test("rows are grouped by day so they can drop their date", async () => {
    const source = await app();
    expect(source).toContain("function notificationDayLabel(");
    expect(source).toContain("const postGroups = useMemo(");
  });

  test("the two-line body is plain text, not a markdown tree per row", async () => {
    const source = await app();
    expect(source).toContain("line-clamp-2");
    expect(source).toContain("{stripMd(post.summary)}");
  });
});

describe("one poller for the shipped head", () => {
  test("the feed subscribes instead of running its own interval", async () => {
    const source = await app();
    const feed = await readFile("web/src/lib/shipped-feed.ts", "utf8");
    expect(feed).toContain("export function subscribeShippedHead");
    expect(feed).toContain("if (inFlight) return inFlight;");
    // No consumer may re-introduce a private interval on this endpoint.
    expect(source).not.toContain('api<{ posts: ShipPost[] }>("/api/shipped?limit=25"');
    expect(source).not.toContain("`/api/shipped?limit=${FEED_PAGE}`");
    // The Live sidebar's "recently shipped" rows were the second subscriber.
    // That category is gone, so the Notification Center is the only one left.
    expect(source.match(/subscribeShippedHead<ShipPost>/g)?.length).toBe(1);
  });

  test("a hidden tab stops polling", async () => {
    const feed = await readFile("web/src/lib/shipped-feed.ts", "utf8");
    expect(feed).toContain('document.visibilityState === "visible"');
    expect(feed).toContain("if (listeners.size === 0)");
    expect(feed).toContain("stopTimer();");
  });
});

describe("the feed ships only what it renders", () => {
  test("the server caps media and clamps the summary", async () => {
    const shipped = await readFile("src/shipped.ts", "utf8");
    expect(shipped).toContain("MAX_FEED_MEDIA");
    expect(shipped).toContain("summaryTruncated");
    // Storage keeps the full summary; only the feed response is clamped.
    expect(shipped).toContain("slice(0, 2000)");
  });

  test("the merged feed is indexed, not rebuilt per request", async () => {
    const shipped = await readFile("src/shipped.ts", "utf8");
    expect(shipped).toContain("mergedCache");
    expect(shipped).toContain("function readMergedPosts(");
  });
});
