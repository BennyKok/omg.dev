// Tell the owner, with no agent. The cheapest action.

import { notifyAll } from "../../push.ts";
import type { Action } from "../types.ts";

type NotifyAction = { kind: "notify" };

export const notifyAction: Action<NotifyAction> = {
  kind: "notify",
  validate() {
    return { ok: true, config: { kind: "notify" } };
  },
  async run(events, _config, hook) {
    const first = events[0].title ?? events[0].topic;
    await notifyAll({
      notification: {
        title: hook.name,
        body: events.length === 1 ? first : `${events.length} new: ${first}`,
        tag: `event-hook-${hook.id}`,
      },
    });
    return `notified (${events.length})`;
  },
};
