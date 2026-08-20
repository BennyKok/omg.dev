import { omgFetch } from "./lib/omg-client";

export async function fetchBootstrap<T>(asUser?: string): Promise<T> {
  // Mirrors the identity already sent to /api/bots?user= (see botUnreadIdentity
  // in App.tsx): the local roster profile this browser is using, for the
  // response's `viewer.participantId` on an unmanaged box. A managed caller's
  // trusted header always wins over this on the server, regardless.
  const query = asUser ? `?user=${encodeURIComponent(asUser)}` : "";
  const res = await omgFetch(`/api/bootstrap${query}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `${res.status}`);
  }
  return data as T;
}
