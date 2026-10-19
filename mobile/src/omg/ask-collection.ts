import { liveCollection, type OmgClient, type OmgLiveCollection } from "@omg-dev/client";

/**
 * The Computer sends a `changed` frame for "ask" the moment an agent asks or a
 * question is answered, so the list is re-read at once, with a 5-minute
 * backstop (liveCollection in @omg-dev/client).
 */

const collections = new WeakMap<OmgClient, OmgLiveCollection<unknown[]>>();

/**
 * Every open ask-user question on the machine (GET /api/ask?status=open), one
 * shared read per client. Each screen filters to the questions it shows, so
 * the session screen and a thread page cost one read between them.
 */
export function openQuestions<T>(client: OmgClient): OmgLiveCollection<T[]> {
  let collection = collections.get(client);
  if (!collection) {
    collection = liveCollection<unknown[]>(
      client.live,
      "ask",
      async () => {
        const res = await client.transport.request<{ questions?: unknown[] }>("/api/ask?status=open");
        return Array.isArray(res?.questions) ? res.questions : [];
      },
    );
    collections.set(client, collection);
  }
  return collection as OmgLiveCollection<T[]>;
}
