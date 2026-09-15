/**
 * Scheduled auto-agent runs are hidden by `/api/sessions/resumable` unless a
 * client asks for them. The web has asked since that landed; this app could
 * not, so the runs vanished here with nothing explaining where they went.
 */
import { expect, test } from "bun:test";
import { archiveUrl, createArchiveBrowser } from "../src/omg/archive";

test("the archive asks for the plain catalog by default", () => {
  expect(archiveUrl("")).not.toContain("includeScheduled");
  expect(archiveUrl("widget", 30)).not.toContain("includeScheduled");
});

test("asking for scheduled runs is what the server actually reads", () => {
  // The endpoint tests `=== "1"`, so nothing else turns it on.
  expect(archiveUrl("", 0, true)).toContain("includeScheduled=1");
});

test("the toggle re-queries, because the filtering is the server's", async () => {
  const urls: string[] = [];
  const browser = createArchiveBrowser({
    request: async (path: string) => {
      urls.push(path);
      return { sessions: [], total: 0, scheduledTotal: 4 } as never;
    },
  });
  await browser.refresh();
  expect(urls[0]).not.toContain("includeScheduled");
  expect(browser.snapshot().scheduledTotal).toBe(4);

  await browser.setIncludeScheduled(true);
  expect(urls[1]).toContain("includeScheduled=1");
  expect(browser.includesScheduled()).toBe(true);

  await browser.setIncludeScheduled(false);
  expect(urls[2]).not.toContain("includeScheduled");
});

test("a search keeps its terms when the toggle flips", async () => {
  const urls: string[] = [];
  const browser = createArchiveBrowser({
    request: async (path: string) => {
      urls.push(path);
      return { sessions: [], total: 0, scheduledTotal: 1 } as never;
    },
  });
  await browser.search("widget");
  await browser.setIncludeScheduled(true);
  expect(urls[1]).toContain("search=widget");
  expect(urls[1]).toContain("includeScheduled=1");
});
