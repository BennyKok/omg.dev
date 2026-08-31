import { omgFetch } from "./omg-client";
import { transcriptPagePath } from "./transcript-paging";

const STORAGE_KEY = "lfg_computer_inspection_targets_v1";
const MAX_TARGETS = 80;

type MessageLike = {
  role?: string;
  text?: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json" | "text">>;

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

function isBackgroundCoordination(text: string | null | undefined): boolean {
  return /^\s*\[Background task\b/i.test(text ?? "");
}

/**
 * The person's latest explicit URL owns the page choice. Assistant answers
 * commonly contain source links and PR URLs, so allowing a later assistant
 * link to win is exactly how Design Mode opens the wrong page.
 */
export function resolveSessionInspectionUrl(messages: MessageLike[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (isBackgroundCoordination(message.text)) continue;
    const urls = urlsInText(message.text);
    if (urls.length) return urls.at(-1) ?? null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const urls = urlsInText(messages[index]?.text);
    if (urls.length) return urls.at(-1) ?? null;
  }
  return null;
}

/**
 * Re-read the server transcript at the moment Design Mode starts. A long chat
 * can have an intentionally shallow browser cache, while its title is clipped
 * in the session list (for example `https://github.com/st`). Treating that
 * display label as navigation state opens the wrong page. The transcript is
 * the source of truth and the caller's loaded messages are only the fallback.
 */
export async function fetchSessionInspectionUrl(
  sessionId: string,
  loadedMessages: MessageLike[],
  fetcher: FetchLike = omgFetch,
): Promise<string | null> {
  if (!sessionId) return resolveSessionInspectionUrl(loadedMessages);
  const response = await fetcher(transcriptPagePath(sessionId));
  if (!response.ok) {
    throw new Error((await response.text()) || "could not read the session page target");
  }
  const payload = (await response.json()) as { messages?: MessageLike[] };
  return (
    resolveSessionInspectionUrl(payload.messages ?? []) ??
    resolveSessionInspectionUrl(loadedMessages)
  );
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
