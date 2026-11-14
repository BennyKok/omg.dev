// Run against a worktree Vite server backed by a local runtime.
// CHAT_CHECK_URL points to an existing /sessions/<id> page. No messages are sent.
// PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE can select local browser tools.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  assert(process.env.CHAT_CHECK_URL, 'Set CHAT_CHECK_URL to an existing session URL');
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
    if (process.env.CHAT_CHECK_USER) {
      await page.addInitScript(user => localStorage.setItem('lfg_user', user), process.env.CHAT_CHECK_USER);
    }
    await page.goto(process.env.CHAT_CHECK_URL, { waitUntil: 'domcontentloaded' });
    const composer = page.locator('[role="dialog"] form[data-composer-kind="session"]').last();
    await composer.waitFor({ timeout: 60000 });
    async function visible(label, height = 852) {
      // Wait for the sheet entrance and the viewport recovery samples.
      await page.waitForTimeout(2800);
      const box = await composer.boundingBox();
      assert(box && box.height > 30 && box.y >= 0 && box.y + box.height <= height + 1,
        `${label}: composer outside visible viewport: ${JSON.stringify(box)}`);
      console.log(`PASS ${label}`);
    }
    await visible('initial mobile chat');
    // Foreground return: the layout viewport retains a larger height while
    // the visual viewport already describes the visible screen. No field has
    // focus. This used to push the entire composer below the screen.
    await page.evaluate(() => {
      document.activeElement?.blur();
      Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => 1100 });
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await visible('stale layout height after foreground return');
    await page.evaluate(() => {
      delete window.innerHeight;
      const field = document.querySelector('[role="dialog"] form[data-composer-kind="session"] textarea');
      field.focus({ preventScroll: true });
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 500 });
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await visible('keyboard open', 500);
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await visible('keyboard closing after focus is lost', 500);
    await page.evaluate(() => {
      delete window.visualViewport.height;
      window.visualViewport.dispatchEvent(new Event('resize'));
      document.querySelector('[role="dialog"] .chat-stream')?.scrollTo(0, 0);
    });
    await visible('keyboard closed and transcript scrolled');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
