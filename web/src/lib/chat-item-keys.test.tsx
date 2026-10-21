import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { useVirtualizer } = await import("@tanstack/react-virtual");
const { useChatItemKey } = await import("./chat-item-keys");

let ui: Mounted | undefined;
afterEach(() => ui?.cleanup());

test("scroll and token renders retain offsets; structural edits preserve row identity", () => {
  let estimates = 0;
  let virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  const estimateSize = () => {
    estimates++;
    return 40;
  };
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    key: `message-${index}`,
    text: "hello",
  }));
  function Transcript({ items }: { items: typeof rows }) {
    const getItemKey = useChatItemKey(items);
    virtualizer = useVirtualizer<HTMLDivElement, Element>({
      count: items.length,
      getScrollElement: () => null,
      getItemKey,
      estimateSize,
      initialRect: { width: 600, height: 700 },
      scrollToFn: () => {},
    });
    return <div>{virtualizer.getTotalSize()}</div>;
  }
  ui = mount();
  ui.render(<Transcript items={rows} />);
  expect(ui.text()).toBe("40000");
  expect(estimates).toBeGreaterThanOrEqual(1000);
  estimates = 0;

  for (let index = 0; index < 10; index++) {
    virtualizer!.scrollOffset = index * 100;
    ui.render(<Transcript items={rows} />);
  }
  const streamed = rows.map((row, index) =>
    index === 999 ? { ...row, text: "hello streamed text" } : row,
  );
  ui.render(<Transcript items={streamed} />);
  expect(ui.text()).toBe("40000");
  expect(estimates).toBe(0);

  // A real row grows. Its measured size stays with its message on reorder,
  // insertion, replacement, and removal, rather than following an old index.
  ui.flush(() => virtualizer!.resizeItem(999, 80));
  const reordered = [...streamed].reverse();
  ui.render(<Transcript items={reordered} />);
  expect(ui.text()).toBe("40040");
  expect(virtualizer!.measurementsCache[0].key).toBe("message-999");
  expect(virtualizer!.measurementsCache[0].size).toBe(80);
  expect(virtualizer!.measurementsCache[1].start).toBe(80);

  const prepended = [{ key: "older-message", text: "older" }, ...reordered];
  ui.render(<Transcript items={prepended} />);
  expect(ui.text()).toBe("40080");
  expect(virtualizer!.measurementsCache[1].key).toBe("message-999");
  expect(virtualizer!.measurementsCache[1].start).toBe(40);

  ui.render(
    <Transcript
      items={[{ key: "replacement", text: "new" }, ...reordered.slice(1)]}
    />,
  );
  expect(ui.text()).toBe("40000");
  expect(virtualizer!.measurementsCache[0].key).toBe("replacement");
  ui.render(<Transcript items={[]} />);
  expect(ui.text()).toBe("0");
});
