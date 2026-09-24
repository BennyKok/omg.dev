import type { OmgGrant } from "@omg-dev/client";

/** One grant and one refresh in flight per binding, including forced reconnect refreshes. */
export function createGrantOwner(mint: () => Promise<OmgGrant>) {
  let cached: OmgGrant | null = null;
  let pending: Promise<OmgGrant> | null = null;
  let generation = 0;
  return {
    async get({ forceRefresh }: { forceRefresh: boolean }): Promise<OmgGrant> {
      if (pending) return pending;
      if (!forceRefresh && cached && cached.expiresAt - Date.now() > 30_000) return cached;
      const ticket = generation;
      const request = Promise.resolve().then(mint).then(grant => {
        if (ticket === generation) cached = grant;
        return grant;
      }).finally(() => { if (pending === request) pending = null; });
      pending = request;
      return request;
    },
    reset() { generation++; cached = null; pending = null; },
  };
}
