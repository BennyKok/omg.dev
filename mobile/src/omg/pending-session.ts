/** Creation outlives the initiating screen; navigation never waits for REST. */
export type PendingSession = {
  token: string;
  scope: string;
  prompt: string;
  result: Promise<string>;
  sessionId?: string;
};
const requests = new Map<string, PendingSession>();
let sequence = 0;
export function startPendingSession(scope: string, prompt: string, create: () => Promise<{ sessionId?: string }>) {
  const token = `${Date.now()}-${++sequence}`;
  const result = Promise.resolve().then(create).then((response) => {
    if (!response.sessionId) throw new Error("The computer did not return a session. Check your sessions before trying again.");
    return response.sessionId;
  });
  // A route may close before it subscribes. The initiating composer still
  // records the outcome in its existing prompt stash.
  void result.catch(() => {});
  const pending: PendingSession = { token, scope, prompt, result };
  void result.then(id => { pending.sessionId = id; }).catch(() => {});
  requests.set(token, pending);
  while (requests.size > 16) requests.delete(requests.keys().next().value!);
  return pending;
}
export function getPendingSession(token: string, scope: string) {
  const pending = requests.get(token);
  return pending?.scope === scope ? pending : null;
}
export function clearPendingSessions() { requests.clear(); }

export function createdSessionPrompt(scope: string, sessionId: string | null) {
  return [...requests.values()].find(request => request.scope === scope && request.sessionId === sessionId)?.prompt;
}
