import { mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import type { OmgChangeTopic } from "../packages/protocol/src/index.ts";

export type ChangeTopic = OmgChangeTopic;
const topics: ChangeTopic[] = ["repos", "pins", "auto", "bots", "ask", "threads", "sessions"];

/**
 * One change bus for stores in the server and in CLI processes. The files are
 * invalidation signals only; lists always come from their existing stores.
 * Watching the directory survives replacement of a signal file. Reconnecting
 * clients read all lists, so no event history or second data store is needed.
 */
export function createChangeBus(directory: () => string) {
  const listeners = new Set<(topic: ChangeTopic) => void>();
  const failures = new Set<(error: Error) => void>();
  const writer = crypto.randomUUID();
  let watcher: FSWatcher | null = null;
  const emit = (topic: ChangeTopic) => {
    for (const listener of listeners) {
      try { listener(topic); } catch {}
    }
  };
  const ensureDirectory = () => {
    const dir = directory();
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  return {
    announce(topic: ChangeTopic) {
      // Publish after the store committed. Other processes can now read it.
      try {
        writeFileSync(join(ensureDirectory(), topic), writer, { mode: 0o600 });
      } catch (error) {
        console.warn("[change-topics] cannot publish cross-process change", topic, error);
      }
      emit(topic);
    },
    subscribe(listener: (topic: ChangeTopic) => void, onError?: (error: Error) => void) {
      if (!watcher) {
        const dir = ensureDirectory();
        watcher = watch(dir, { persistent: false }, (_event, filename) => {
          const name = filename?.toString();
          for (const topic of topics) {
            if (name && name !== topic) continue;
            // Own writes have already been delivered synchronously. A racing
            // external write may be coalesced, but the read sees both writes.
            try { if (readFileSync(join(dir, topic), "utf8") === writer) continue; } catch {}
            emit(topic);
          }
        });
        watcher.on("error", (error) => {
          console.warn("[change-topics] watcher failed", error);
          watcher?.close();
          watcher = null;
          for (const fail of [...failures]) fail(error);
        });
      }
      listeners.add(listener);
      if (onError) failures.add(onError);
      return () => {
        listeners.delete(listener);
        if (onError) failures.delete(onError);
        if (!listeners.size) {
          watcher?.close();
          watcher = null;
        }
      };
    },
  };
}

const bus = createChangeBus(() => join(PATHS.data, "change-signals"));
export const announceChange = bus.announce;
export const onChangeAnnounced = bus.subscribe;
