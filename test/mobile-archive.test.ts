import { expect, test } from "bun:test";
import {
  archiveUrl,
  createArchiveBrowser,
  resumeArchivedSession,
  type ArchiveTransport,
} from "../mobile/src/omg/archive";
const row = (id: string) => ({
  sessionId: id,
  title: id,
  agent: "codex",
  project: "lfg",
  cwd: null,
  lastUserText: null,
  lastActivityAt: null,
});
function queue() {
  const calls: {
    url: string;
    resolve: (v: any) => void;
    reject: (e: Error) => void;
  }[] = [];
  const transport: ArchiveTransport = {
    request: <T>(url: string) =>
      new Promise<T>((resolve, reject) => calls.push({ url, resolve, reject })),
  };
  return { transport, calls };
}
test("archive query encodes search and pagination", () => {
  expect(archiveUrl(" a & b ", 30)).toBe(
    "/api/sessions/resumable?limit=30&offset=30&search=a+%26+b",
  );
});
test("late searches and detached screens cannot repaint the archive", async () => {
  const { transport, calls } = queue(),
    browser = createArchiveBrowser(transport);
  const old = browser.search("old"),
    next = browser.search("new");
  calls[1].resolve({ sessions: [row("new")], total: 1 });
  await next;
  calls[0].resolve({ sessions: [row("old")], total: 1 });
  await old;
  expect(browser.snapshot().items[0].sessionId).toBe("new");
  const pending = browser.refresh();
  browser.cancel();
  calls[2].resolve({ sessions: [row("late")] });
  await pending;
  expect(browser.snapshot().items).toEqual([]);
});
test("pagination appends once and stops at the total", async () => {
  const { transport, calls } = queue(),
    browser = createArchiveBrowser(transport);
  const first = browser.search("");
  calls[0].resolve({ sessions: [row("a")], total: 2 });
  await first;
  const more = browser.more();
  void browser.more();
  expect(calls).toHaveLength(2);
  expect(calls[1].url).toContain("offset=1");
  calls[1].resolve({ sessions: [row("b")], total: 2 });
  await more;
  await browser.more();
  expect(calls).toHaveLength(2);
  expect(browser.snapshot().items.map((x) => x.sessionId)).toEqual(["a", "b"]);
});
test("a failed archive load can be retried", async () => {
  const { transport, calls } = queue(),
    browser = createArchiveBrowser(transport);
  const bad = browser.refresh();
  calls[0].reject(Error("Computer offline"));
  await bad;
  expect(browser.snapshot().error).toBe("Computer offline");
  const good = browser.refresh();
  calls[1].resolve({ sessions: [], total: 0 });
  await good;
  expect(browser.snapshot().error).toBeNull();
});
test("resume follows a changed session ID and sends no duplicate prompt", async () => {
  let body: any;
  const transport: ArchiveTransport = {
    request: async <T>(url, init) => {
      expect(url).toBe("/api/sessions/resume");
      expect(init?.method).toBe("POST");
      body = JSON.parse(String(init?.body));
      return { sessionId: "new-id" } as T;
    },
  };
  expect(await resumeArchivedSession(transport, "old-id")).toBe("new-id");
  expect(body).toEqual({ sessionId: "old-id" });
});
