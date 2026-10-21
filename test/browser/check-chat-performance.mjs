// Run against the web Vite dev server. See docs/visible-ui-performance.md.
const { chromium, webkit } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import assert from "node:assert/strict";
const variant = process.argv[2] ?? "changed";
const useWebkit = process.argv.includes("--webkit");
const browser = await (useWebkit ? webkit : chromium).launch(
  useWebkit
    ? { headless: true, executablePath: process.env.WEBKIT_EXECUTABLE }
    : {
        headless: true,
        executablePath: process.env.CHROMIUM_EXECUTABLE,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      },
);
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.log("Page error", e.message);
});
try {
  await page.addInitScript(() => {
    window.__estimates = 0;
    window.__probes = 0;
    const a = Node.prototype.appendChild;
    Node.prototype.appendChild = function (n) {
      if (n instanceof HTMLElement && n.dataset.markdownProbe)
        window.__probes++;
      return a.call(this, n);
    };
  });
  await page.route(/\/src\/App\.tsx(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    const needle = "const estimateSize = useCallback(\n    (index) => {";
    assert(body.includes(needle));
    if (process.argv.includes("--baseline-keys"))
      body = body.replace(
        /getItemKey,\s*rangeExtractor/,
        "getItemKey: (index) => items[index]?.key ?? index, rangeExtractor",
      );
    if (process.argv.includes("--debug-anchors")) {
      body = body.replace(
        "anchorRef.current = { key, offset: top - rect.top };",
        'anchorRef.current = { key, offset: top - rect.top }; (window.__anchorEvents??=[]).push({kind:"captureDOM",key,offset:top-rect.top,top:el.scrollTop,index:node.dataset.index});',
      );
      body = body.replace(
        "anchorRef.current = { key: String(row.key), offset: el.scrollTop - row.start };",
        'anchorRef.current = { key: String(row.key), offset: el.scrollTop - row.start }; (window.__anchorEvents??=[]).push({kind:"capture",index:row.index,key:row.key,offset:el.scrollTop-row.start,start:row.start,top:el.scrollTop,transform:virtualContainerRef.current?.querySelector(`[data-index="${row.index}"]`)?.style.transform});',
      );
      body = body.replace(
        "if (Math.abs(clamped - el.scrollTop) > 0.5) el.scrollTop = clamped;",
        'if (Math.abs(clamped - el.scrollTop) > 0.5) { (window.__anchorEvents??=[]).push({kind:"hold",index,key:anchor.anchorKey,offset:anchor.anchorOffset,start,from:el.scrollTop,to:clamped,transform:virtualContainerRef.current?.querySelector(`[data-index="${index}"]`)?.style.transform}); el.scrollTop = clamped; }',
      );
    }
    body =
      body.replace(needle, needle + "\n window.__estimates++;") +
      "\nexport { ChatStream };";
    await route.fulfill({ response, body });
  });
  const base = process.env.PERF_BASE_URL || "http://127.0.0.1:5174";
  await page.route("**/perf-chat.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/src/test-support/chat-performance.fixture.tsx"></script></body></html>',
    }),
  );
  await page.goto(`${base}/perf-chat.html`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-session-ready="true"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const read = () =>
    page.locator('[data-session-ready="true"]').evaluate((el) => ({
      top: el.scrollTop,
      bottom: el.scrollHeight - el.clientHeight - el.scrollTop,
      rows: el.querySelectorAll("[data-index]").length,
      dom: el.querySelectorAll("*").length,
      estimates: window.__estimates,
      probes: window.__probes,
    }));
  const reset = () =>
    page.evaluate(() => {
      window.__estimates = 0;
      window.__probes = 0;
    });
  const initial = await read();
  assert(initial.rows < 50, "Transcript must stay virtualized");
  await reset();
  for (let n = 1; n <= 25; n++) {
    await page.evaluate((n) => window.__chat.update(n), n);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
  await page.getByText("Update 25", { exact: true }).waitFor();
  const streaming = await read();
  assert(streaming.bottom <= 4, `Streaming lost bottom: ${streaming.bottom}`);
  const pane = page.locator('[data-session-ready="true"]');
  if (process.argv.includes("--scrollbar")) {
    // Model the pointer intent and offset change made by dragging a scrollbar.
    // This checks anchor behavior without claiming a native wheel/trackpad test.
    await pane.evaluate((el) => {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      el.scrollTop -= 3000;
    });
  } else {
    await pane.hover();
    await page.mouse.wheel(0, -3000);
  }
  await page.waitForTimeout(600);
  assert(
    (await read()).bottom > 500,
    "Scroll input did not leave the live bottom",
  );
  const anchor = await pane.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const rows = [...el.querySelectorAll("[data-index]")];
    const row = rows.find((r) => {
      const box = r.getBoundingClientRect();
      return box.top <= top + 20 && box.bottom > top + 20;
    });
    if (!row) throw Error("No reading anchor");
    return {
      index: row.dataset.index,
      offset: row.getBoundingClientRect().top - top,
      scrollTop: el.scrollTop,
    };
  });
  await reset();
  for (let n = 26; n <= 40; n++) {
    await page.evaluate((n) => window.__chat.update(n), n);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
  await page
    .getByText("Update 40", { exact: true })
    .waitFor({ state: "attached" });
  const reading = await read();
  const offset = await pane.evaluate((el, index) => {
    const row = el.querySelector(`[data-index="${index}"]`);
    if (!row) throw Error("Reading anchor was unmounted");
    return row.getBoundingClientRect().top - el.getBoundingClientRect().top;
  }, anchor.index);
  assert(reading.bottom > 500, "New text pulled the reader to the bottom");
  await reset();
  await page.evaluate(() => window.__chat.switch());
  await page.locator('[data-session-ready="true"]').waitFor();
  await page.waitForTimeout(500);
  const switched = await read();
  assert(
    switched.bottom <= 4,
    `Switch did not land at bottom: ${switched.bottom}`,
  );
  // Reproduce a browser delivering scroll after a streamed render. Suppress
  // this event so only the follow owner's pre-write check can preserve intent.
  await pane.evaluate((el) => {
    el.addEventListener("scroll", (event) => event.stopImmediatePropagation(), {
      once: true,
      capture: true,
    });
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    el.scrollTop -= 2000;
    window.__chat.update(1);
  });
  await page.waitForTimeout(400);
  const deferredScroll = await read();
  assert(
    deferredScroll.bottom > 500,
    "A streamed render overwrote a pending user scroll",
  );
  const result = {
    variant,
    engine: useWebkit ? "webkit" : "chromium",
    input: process.argv.includes("--scrollbar")
      ? "simulated-scrollbar"
      : "native-wheel",
    initial,
    streaming,
    reading,
    anchor,
    anchorMovement: offset - anchor.offset,
    switched,
    deferredScroll,
    errors,
    anchors: await page.evaluate(() => window.__anchorEvents),
  };
  console.log(JSON.stringify(result));
  assert.equal(errors.length, 0);
  assert(
    Math.abs(offset - anchor.offset) < 3,
    `Reading position moved ${offset - anchor.offset}px`,
  );
} catch (e) {
  console.log("Failure", errors);
  throw e;
} finally {
  await page.close();
  await browser.close();
}
