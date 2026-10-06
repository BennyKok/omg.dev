import type { LiveActivityComponent, LiveActivityFactory } from "expo-widgets";

export type PlatformLiveActivityFactory<T extends object> = Pick<
  LiveActivityFactory<T>,
  "start" | "getInstances"
>;

/**
 * expo-widgets exposes its JavaScript API on Android, but its native Live
 * Activity constructor exists only on iOS. Do not construct it on platforms
 * that cannot provide the native object.
 */
export function createPlatformLiveActivity<T extends object>(
  platform: string,
  create: (name: string, component: LiveActivityComponent<T>) => LiveActivityFactory<T>,
  name: string,
  component: LiveActivityComponent<T>,
): PlatformLiveActivityFactory<T> {
  if (platform === "ios") return create(name, component);

  return {
    getInstances: () => [],
    start: () => {
      throw new Error("Live Activities are available only on iOS");
    },
  };
}
