/**
 * Jev, TypeSafe's System One model, as the e2e decision layer.
 *
 * One HTTP call answers several typed questions about a piece of state and
 * comes back in about half a second with probabilities, not prose. The state
 * here is the screen's accessibility tree; the questions are "is this step
 * done", "is this a dead end", and "which element gets us there". Code keeps
 * every exact fact (the strings a feature must show); Jev only supplies the
 * judgment that a fixed selector cannot: the screen changed a little, is it
 * still the right screen?
 *
 * API: POST https://api.typesafe.ai/v1/systemone (docs.typesafe.ai/api).
 * The key comes from TYPESAFE_API_KEY, or ~/.config/typesafe/env.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export type Noul = { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } };
export type Choice = { type: "choice"; instructions: string; criteria: Record<string, string | null> };
export type Question = Noul | Choice;
export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };

let cachedKey: string | null = null;
async function apiKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  let key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    const file = Bun.file(join(homedir(), ".config/typesafe/env"));
    if (await file.exists()) {
      key = (await file.text()).match(/^TYPESAFE_API_KEY=(.+)$/m)?.[1]?.trim();
    }
  }
  if (!key) throw new Error("No TypeSafe key. Set TYPESAFE_API_KEY or put it in ~/.config/typesafe/env.");
  cachedKey = key;
  return key;
}

export async function judge<Q extends Record<string, Question>>(
  state: unknown,
  questions: Q,
): Promise<{ [K in keyof Q]: Answer } & { ms: number }> {
  const started = Date.now();
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${await apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: "jev-latest", questions }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { answers: Record<string, Answer> };
  return { ...(body.answers as any), ms: Date.now() - started };
}
