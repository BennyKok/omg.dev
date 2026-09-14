type Activity = {
  getId(): string;
  getPushToken(): Promise<string | null>;
  addPushTokenListener(listener: (event: { activityId: string; pushToken: string }) => void): { remove(): void };
};

/** Device registration must finish before its per-activity tokens are sent. */
export function liveActivityRegistration(options: {
  getInstances(): Activity[];
  isForeground(): boolean;
  registerDevice(token: string, hasActiveActivity?: boolean): Promise<void>;
  registerActivity(id: string, token: string): Promise<void>;
  onError(error: unknown): void;
}) {
  let disposed = false;
  let startToken: string | null = null;
  let pending = Promise.resolve();
  const subscriptions = new Map<string, { remove(): void }>();
  const tokens = new Map<string, string>();

  const refresh = () => {
    pending = pending.then(async () => {
      if (disposed || !startToken) return;
      const instances = options.getInstances();
      const ids = new Set(instances.map((instance) => instance.getId()));
      for (const [id, subscription] of subscriptions) {
        if (!ids.has(id)) { subscription.remove(); subscriptions.delete(id); tokens.delete(id); }
      }
      for (const instance of instances) {
        const id = instance.getId();
        if (!subscriptions.has(id)) {
          subscriptions.set(id, instance.addPushTokenListener((event) => {
            if (disposed) return;
            tokens.set(event.activityId, event.pushToken);
            void refresh();
          }));
        }
      }
      await options.registerDevice(startToken, options.isForeground() ? instances.length > 0 : undefined);
      for (const instance of instances) {
        if (disposed) return;
        const token = tokens.get(instance.getId()) ?? await instance.getPushToken();
        if (!disposed && token) await options.registerActivity(instance.getId(), token);
      }
    }).catch(options.onError);
    return pending;
  };
  return {
    refresh,
    onStartToken(token: string) { startToken = token; return refresh(); },
    dispose() {
      disposed = true;
      for (const subscription of subscriptions.values()) subscription.remove();
      subscriptions.clear();
      tokens.clear();
    },
  };
}
