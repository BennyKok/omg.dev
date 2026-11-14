import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { createRef, useState } from "react";

const { MobileHomeComposer } = await import("./mobile-home-composer");
let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("covering home removes its input from the active surface without losing the draft", () => {
  const ref = createRef<HTMLDivElement>();
  let mounts = 0;
  function Draft() {
    const [draft] = useState(() => { mounts++; return "Unsent home draft"; });
    return <textarea defaultValue={draft} />;
  }
  const render = (covered: boolean) => ui.render(
    <MobileHomeComposer covered={covered} containerRef={ref}><Draft /></MobileHomeComposer>,
  );
  render(false);
  const field = ui.query("textarea") as HTMLTextAreaElement;
  ui.flush(() => field.focus());
  expect(document.activeElement).toBe(field);
  render(true);
  expect(ref.current?.inert).toBe(true);
  expect(ref.current?.getAttribute("aria-hidden")).toBe("true");
  expect(ref.current?.classList.contains("invisible")).toBe(true);
  expect(document.activeElement).not.toBe(field);
  render(false);
  expect(ref.current?.inert).toBe(false);
  expect(ref.current?.classList.contains("invisible")).toBe(false);
  expect(ui.query("textarea")).toBe(field);
  expect(field.value).toBe("Unsent home draft");
  expect(mounts).toBe(1);
});

test("covering home does not blur the open chat's field", () => {
  const ref = createRef<HTMLDivElement>();
  const render = (covered: boolean) => ui.render(<>
    <MobileHomeComposer covered={covered} containerRef={ref}><textarea aria-label="Home" /></MobileHomeComposer>
    <textarea aria-label="Reply" />
  </>);
  render(false);
  const reply = ui.query('[aria-label="Reply"]') as HTMLTextAreaElement;
  ui.flush(() => reply.focus());
  render(true);
  expect(document.activeElement).toBe(reply);
});
