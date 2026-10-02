// The text to show when POST /api/computer/start fails.
//
// The server answers a failed start with `{ "error": "<sentence>" }`. The
// Computer page used to print that body as it arrived, so a person saw raw
// JSON such as `{"error":"computer failed to start (rfb=up cdp=down)"}`.
// Show the sentence, and fall back to a plain message for anything else.

export const COMPUTER_START_FALLBACK = "The Computer could not start. Try again.";

export function computerStartErrorMessage(body: string): string {
  const text = body.trim();
  if (!text) return COMPUTER_START_FALLBACK;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === "string" && error.trim()) return error.trim();
    }
    return COMPUTER_START_FALLBACK;
  } catch {
    // A proxy or gateway page is not a sentence a person can act on.
    return text.startsWith("<") ? COMPUTER_START_FALLBACK : text;
  }
}
