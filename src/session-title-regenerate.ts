import { generateSessionTitle } from "./session-auto-title.ts";

/**
 * Re-run the automatic title for a session that already exists.
 *
 * The spawn-time pass in `serve.ts` is fire-and-forget and only runs for a
 * session created without an explicit title. This is the path back to a
 * generated title after a rename, after a failed first attempt, or for a
 * session that was created before automatic titles existed.
 *
 * The work is pure orchestration, so every dependency arrives as an argument.
 * That keeps it testable without an HTTP server, a transcript index, or an
 * account.
 */
export type RegenerateSessionTitleDeps = {
  /** True when the managed AI route can be reached at all. */
  aiAvailable: () => boolean;
  /** Transcript file path for the session, or null when there is none. */
  resolveTranscript: (sessionId: string) => Promise<string | null>;
  /** First user prompt in that transcript, or null. */
  firstUserText: (path: string) => Promise<string | null>;
  /** Persist the title. This is the same override store a human rename uses. */
  setTitle: (sessionId: string, title: string) => Promise<void>;
  /** Injection point for the model call. Defaults to the real one. */
  generate?: (prompt: string) => Promise<string | null>;
};

export type RegenerateSessionTitleResult =
  | { ok: true; title: string }
  | { ok: false; status: number; error: string };

export async function regenerateSessionTitle(
  sessionId: string,
  deps: RegenerateSessionTitleDeps,
): Promise<RegenerateSessionTitleResult> {
  if (!deps.aiAvailable()) {
    return { ok: false, status: 503, error: "managed AI is not available" };
  }
  const path = await deps.resolveTranscript(sessionId).catch(() => null);
  if (!path) return { ok: false, status: 404, error: "session transcript not found" };

  const prompt = await deps.firstUserText(path).catch(() => null);
  if (!prompt?.trim()) {
    return { ok: false, status: 422, error: "session has no prompt to title" };
  }

  const generate = deps.generate ?? ((text: string) => generateSessionTitle(text));
  const title = (await generate(prompt).catch(() => null))?.trim();
  // A null here is the normal failure shape of the generator: no account, a
  // timeout, a rejected plan, or a response that cleaned down to nothing. None
  // of those should change the stored title.
  if (!title) return { ok: false, status: 502, error: "could not generate a title" };

  await deps.setTitle(sessionId, title);
  return { ok: true, title };
}
