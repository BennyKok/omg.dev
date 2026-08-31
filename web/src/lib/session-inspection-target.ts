const STORAGE_KEY = "lfg_computer_inspection_targets_v1";
const MAX_TARGETS = 80;

type MessageLike = {
  role?: string;
  text?: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type StoredTarget = {
  sessionId: string;
  pageUrl: string;
  updatedAt: number;
};

function browserStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function validWebUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function urlsInText(text: string | null | undefined): string[] {
  if (!text) return [];
  return Array.from(text.matchAll(/https?:\/\/[^\s<>"']+/gi), (match) =>
    match[0].replace(/[)\]},.;!?]+$/g, ""),
  ).flatMap((candidate) => {
    const valid = validWebUrl(candidate);
    return valid ? [valid] : [];
  });
}

/**
 * The person's latest explicit URL owns the page choice. Assistant answers
 * commonly contain source links and PR URLs, so allowing a later assistant
 * link to win is exactly how Design Mode opens the wrong page.
 */
export function resolveSessionInspectionUrl(
  messages: MessageLike[],
  sessionTitle: string | null | undefined,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const urls = urlsInText(message.text);
    if (urls.length) return urls.at(-1) ?? null;
  }

  const titleUrl = urlsInText(sessionTitle).at(-1);
  if (titleUrl) return titleUrl;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const urls = urlsInText(messages[index]?.text);
    if (urls.length) return urls.at(-1) ?? null;
  }
  return null;
}

function readTargets(storage: StorageLike | null): StoredTarget[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (target): target is StoredTarget =>
        !!target &&
        typeof target.sessionId === "string" &&
        typeof target.pageUrl === "string" &&
        typeof target.updatedAt === "number" &&
        !!validWebUrl(target.pageUrl),
    );
  } catch {
    return [];
  }
}

export function stashSessionInspectionTarget(
  sessionId: string,
  pageUrl: string | null,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage || !sessionId) return;
  const valid = validWebUrl(pageUrl);
  const targets = readTargets(storage).filter((target) => target.sessionId !== sessionId);
  if (valid) targets.unshift({ sessionId, pageUrl: valid, updatedAt: Date.now() });
  storage.setItem(STORAGE_KEY, JSON.stringify(targets.slice(0, MAX_TARGETS)));
}

export function readSessionInspectionTarget(
  sessionId: string,
  storage: StorageLike | null = browserStorage(),
): string | null {
  return readTargets(storage).find((target) => target.sessionId === sessionId)?.pageUrl ?? null;
}
