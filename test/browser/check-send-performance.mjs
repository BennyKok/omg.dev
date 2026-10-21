// Real composer and SDK; all API calls stay inside the browser fixture.
import assert from "node:assert/strict";
const { chromium, webkit } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const baseline = process.argv.includes("--baseline-projection");
const useWebkit = process.argv.includes("--webkit");
const browser = await (useWebkit ? webkit : chromium).launch(
  useWebkit
    ? { headless: true, executablePath: process.env.WEBKIT_EXECUTABLE }
    : {
        headless: true,
        executablePath: process.env.CHROMIUM_EXECUTABLE,
        args: ["--no-sandbox"],
      },
);
const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.addInitScript(() => {
    // Headless WebKit has no audio device. Use the existing user preference.
    localStorage.setItem(
      "lfg_ui_feedback",
      JSON.stringify({ sound: false, haptics: false }),
    );
    window.__sendStats = { bubbles: 0, history: 0 };
  });
  await page.route(/\/src\/App\.tsx(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    const needle =
      "const viewerParticipantId = useContext(ViewerIdentityContext);";
    assert(body.includes(needle), "Missing bubble instrumentation point");
    body = body.replace(
      needle,
      `${needle}\nwindow.__sendStats.bubbles++; if(message.id?.startsWith("history-")) window.__sendStats.history++;`,
    );
    if (baseline) {
      const projection = "useMemo(createOmgMessageProjector, [])";
      assert(body.includes(projection));
      body =
        'import {omgUIMessagesToMessages as baselineProjection} from "/src/lib/omg-chat-transport.ts";\n' +
        body.replace(projection, "useMemo(() => baselineProjection, [])");
    }
    await route.fulfill({ response, body: body + "\nexport { SessionChat };" });
  });
  const history = Array.from({ length: 1000 }, (_, i) => ({
    id: `history-${i}`,
    role: i % 2 ? "assistant" : "user",
    kind: "text",
    ts: 1700000000000 + i * 1000,
    text: `Historical message ${i}. This has enough words to wrap into a few lines in the conversation.\n\nKeep this settled paragraph stable.`,
  }));
  let releaseSend;
  let sends = 0;
  const pendingResponse = new Promise((resolve) => {
    releaseSend = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/send")) {
      sends++;
      if (sends === 1) {
        await pendingResponse;
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({
        status: 503,
        json: { error: "Fixture send rejected" },
      });
    }
    await route.fulfill({
      json: path.endsWith("/messages")
        ? { messages: history, nextBefore: null }
        : path.endsWith("/queue")
          ? { queue: [] }
          : { requests: [], questions: [] },
    });
  });
  await page.route("**/perf-send.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/test-support/send-performance.fixture.tsx"></script></body></html>',
    }),
  );
  await page.goto(
    `${process.env.PERF_BASE_URL || "http://127.0.0.1:5196"}/perf-send.html`,
  );
  const input = page.locator("textarea").first();
  await input.waitFor({ timeout: 30000 });
  await page.locator('[data-session-ready="true"]').waitFor();
  await page.waitForTimeout(500);
  const reset = () =>
    page.evaluate(() => {
      window.__sendStats = { bubbles: 0, history: 0 };
    });
  const stats = () => page.evaluate(() => ({ ...window.__sendStats }));
  await reset();
  await input.pressSequentially("Please test this send", { delay: 15 });
  const typing = await stats();
  assert.equal(typing.history, 0, "Typing rerendered the transcript");
  await reset();
  await input.press("Enter");
  await page.getByText("Please test this send", { exact: true }).waitFor();
  assert.equal(await input.inputValue(), "");
  assert.equal(sends, 1);
  const sending = await stats();
  const sendPosition = await page.locator(".lfg-user-send").first().evaluate(el => {
    const pane = el.closest("[data-session-ready]");
    const box = el.getBoundingClientRect();
    const viewport = pane.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, viewportTop: viewport.top, viewportBottom: viewport.bottom,
      bottomGap: pane.scrollHeight - pane.clientHeight - pane.scrollTop };
  });
  assert(sendPosition.top < sendPosition.viewportBottom && sendPosition.bottom > sendPosition.viewportTop,
    `Sent message is outside the visible transcript: ${JSON.stringify(sendPosition)}`);

  const motion = await page
    .locator(".lfg-user-send")
    .first()
    .evaluate((el) => ({
      duration: getComputedStyle(el).animationDuration,
      transform: getComputedStyle(el).transform,
    }));
  releaseSend();
  await page.waitForTimeout(100);
  const emit = (event) =>
    page.evaluate((event) => window.__send.emit(event), event);
  await reset();
  await emit({
    type: "ai_part",
    part: { type: "text-start", id: "reply", kind: "text", ts: Date.now() },
  });
  let text = "";
  for (let i = 0; i < 30; i++) {
    const delta = `Reply words ${i}.\n\n`;
    text += delta;
    await emit({
      type: "ai_part",
      part: { type: "text-delta", id: "reply", delta },
    });
    await page.waitForTimeout(30);
  }
  await page.getByText("Reply words 29.", { exact: true }).waitFor();
  const streaming = await stats();
  const streamingBottom = await page.locator('[data-session-ready="true"]').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
  assert(streamingBottom <= 4, `Reply did not follow the visible bottom: ${streamingBottom}`);

  await emit({
    type: "message",
    message: {
      id: "settled-reply",
      role: "assistant",
      kind: "text",
      text,
      ts: Date.now(),
    },
  });
  await emit({ type: "busy", busy: false });
  await page.waitForTimeout(600);
  assert.equal(
    await page.getByText("Reply words 29.", { exact: true }).count(),
    1,
  );

  // A send from history is an explicit request to return to this new turn.
  await page.locator('[data-session-ready="true"]').evaluate(el => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    el.scrollTop -= 1500;
  });
  await page.waitForTimeout(100);
  await input.fill("Keep this rejected draft");
  await input.press("Enter");
  await page.getByText("Fixture send rejected", { exact: true }).waitFor();
  assert.equal(await input.inputValue(), "Keep this rejected draft");
  assert.equal(sends, 2);
  const returnedToLatest = await page.locator('[data-session-ready="true"]').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
  assert(returnedToLatest <= 4, `Sending from history did not reveal the new turn: ${returnedToLatest}`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page
    .locator(".lfg-user-send")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  assert.equal(reduced, "none");
  assert.equal(motion.duration, "0.1s");
  assert.equal(motion.transform, "none");
  if (!baseline) {
    assert(sending.history <= 1, "Sending repainted unchanged history");
    assert(streaming.history <= 2, "Streaming repainted unchanged history");
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    JSON.stringify({
      engine: useWebkit ? "webkit" : "chromium",
      baseline,
      typing,
      sending,
      streaming,
      visibleBeforeServerResponse: true,
      sendPosition,
      rejectedDraftRestored: true,
      motion,
      reduced,
      errors,
    }),
  );
} finally {
  await page.close();
  await browser.close();
}
