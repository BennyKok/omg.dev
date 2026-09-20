import { useCallback, useState } from "react";
import { FlatList, type FlatListProps, type ViewToken } from "react-native";
import { SessionActivityPane } from "./session-activity";

const viewabilityConfig = { itemVisiblePercentThreshold: 1 };

/** Buffered rows stay mounted for scrolling, but only visible rows animate. */
export function WindowedSessionList<T extends { key: string }>({
  renderItem, ...props
}: FlatListProps<T>) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<T>[] }) => {
    const next = new Set(viewableItems.filter((item) => item.isViewable).map((item) => item.item.key));
    setVisible((current) => current.size === next.size && [...current].every((key) => next.has(key)) ? current : next);
  }, []);
  return <FlatList {...props}
    initialNumToRender={8} maxToRenderPerBatch={6} windowSize={5}
    keyExtractor={(item) => item.key}
    extraData={visible}
    viewabilityConfig={viewabilityConfig}
    onViewableItemsChanged={onViewableItemsChanged}
    renderItem={(info) => <SessionActivityPane onScreen={visible.has(info.item.key)}>
      {renderItem?.(info)}
    </SessionActivityPane>}
  />;
}
