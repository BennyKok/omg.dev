import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { createPromptStash, type DraftContext } from "./prompt-stash-store";
export { stashScope } from "./prompt-stash-store";
const stores = new Map<string, ReturnType<typeof createPromptStash>>();
export function promptStash(scope: string) {
  let store = stores.get(scope);
  if (!store) {
    store = createPromptStash(AsyncStorage, scope);
    stores.set(scope, store);
  }
  return store;
}
export function usePromptDraft(scope: string, context: DraftContext) {
  const store = useMemo(() => promptStash(scope), [scope]);
  const metadata = useMemo(
    () => context,
    [
      context.context,
      context.title,
      context.sessionId,
      context.botId,
      context.cwd,
    ],
  );
  const read = useCallback(
    () => store.text(metadata.context),
    [store, metadata.context],
  );
  const text = useSyncExternalStore(store.subscribe, read, read);
  const set = useCallback(
    (next: SetStateAction<string>) => {
      store.set(
        metadata,
        typeof next === "function" ? next(store.text(metadata.context)) : next,
      );
    },
    [store, metadata],
  );
  const stage = useCallback(
    (text: string) => store.stage(metadata, text),
    [store, metadata],
  );
  return { text, set, stage, finish: store.finish };
}
