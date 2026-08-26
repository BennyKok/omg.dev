import { expect, test } from "bun:test";

const APP = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
const CSS = await Bun.file(new URL("./index.css", import.meta.url)).text();

test("harvested markdown metrics invalidate TanStack's stale fallback offsets", () => {
  const start = APP.indexOf("const measuredMetricsVersionRef = useRef(0);");
  const end = APP.indexOf("const virtualRows = virtualizer.getVirtualItems();", start);
  const effect = APP.slice(start, end);

  expect(start).toBeGreaterThan(0);
  expect(effect).toContain("metrics.version === measuredMetricsVersionRef.current");
  expect(effect).toContain("virtualizer.measure();");
  expect(effect).toContain("virtualizer.measureElement(row);");
  expect(effect).toContain("[metrics.version, rowContext, virtualizer]");
  expect(effect).not.toContain("scrollTop =");
});

test("a session switch resets transcript following before paint", () => {
  const comment = "// Scroll intent belongs to one transcript.";
  const at = APP.indexOf(comment);
  const start = APP.lastIndexOf("useLayoutEffect(() => {", at);
  const end = APP.indexOf("}, [sid, stopGlide]);", at);
  const effect = APP.slice(start, end);

  expect(at).toBeGreaterThan(0);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  expect(effect).toContain("setStick(true);");
  expect(effect).toContain("prevStickRef.current = true;");
  expect(effect).toContain("justSwitchedRef.current = true;");
});

test("a session switch snaps after virtual layout and before its reveal", () => {
  const comment = "// A session switch is not a live arrival.";
  const at = APP.indexOf(comment);
  const start = APP.indexOf("useLayoutEffect(() => {", at);
  const end = APP.indexOf("}, [loading, revealedSid, sid, stopGlide]);", at);
  const effect = APP.slice(start, end);

  expect(at).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(at);
  expect(end).toBeGreaterThan(start);
  expect(effect).toContain("requestAnimationFrame(() => {");
  expect(effect).toContain("const bottom = Math.max(0, el.scrollHeight - el.clientHeight);");
  expect(effect).toContain("el.scrollTop = bottom;");
  expect(effect).toContain("setRevealedSid(sid);");
  expect(effect.indexOf("el.scrollTop = bottom;")).toBeLessThan(effect.indexOf("setRevealedSid(sid);"));
});

test("the live-arrival spring cannot start while a session reveal is pending", () => {
  const start = APP.indexOf("const switching = revealedSid !== sid;");
  const end = APP.indexOf('if (glideAction === "start")', start);
  const follow = APP.slice(start, end);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  expect(follow).toContain("if (switching) {");
  expect(follow).toContain("stopGlide();");
  expect(follow).toContain("el.scrollTop = bottom;");
  expect(follow.indexOf("if (switching) {")).toBeLessThan(follow.indexOf("transcriptGlideAction({"));
});

test("a session switch reveals the complete transcript with one opacity-only fade", () => {
  expect(APP).toContain('key={sid ?? "no-session"}');
  expect(APP).toContain('"chat-stream lfg-transcript-session');
  expect(APP).toContain('data-session-ready={revealedSid === sid ? "true" : "false"}');
  expect(CSS).toContain("@keyframes lfg-transcript-session-in");
  expect(CSS).toContain('.lfg-transcript-session[data-session-ready="true"]');

  const start = CSS.indexOf("@keyframes lfg-transcript-session-in");
  const end = CSS.indexOf(".lfg-transcript-session", start);
  const keyframes = CSS.slice(start, end);
  expect(keyframes).toContain("opacity: 0;");
  expect(keyframes).toContain("opacity: 1;");
  expect(keyframes).not.toContain("transform:");
});

test("a keyboard show or hide re-pins a transcript that was following", () => {
  // The soft keyboard resizes the scroll pane without changing any message, so
  // none of the follow effect's content dependencies move. The pane's own
  // height is what carries that event into the effect.
  const at = APP.indexOf("const [viewportHeight, setViewportHeight] = useState(0);");
  expect(at).toBeGreaterThan(0);

  // The effect BODY, past the comment, so prose about scrollTop cannot pass or
  // fail the "never writes scrollTop" assertion below.
  const obsAt = APP.indexOf("// Publish the pane's own height", at);
  const bodyAt = APP.indexOf("useLayoutEffect(() => {", obsAt);
  const obsEnd = APP.indexOf("}, [sid]);", bodyAt);
  const observer = APP.slice(bodyAt, obsEnd);
  expect(obsAt).toBeGreaterThan(at);
  expect(bodyAt).toBeGreaterThan(obsAt);
  expect(observer).toContain("new ResizeObserver(read)");
  expect(observer).toContain("setViewportHeight(Math.round(el.clientHeight))");
  // Scroll position keeps one owner: the observer reports, it never writes.
  expect(observer).not.toContain("scrollTop");
  // The scroller carries key={sid}, so a switch replaces the element. An
  // observer mounted once would be left watching the detached node.
  expect(APP).toContain('key={sid ?? "no-session"}');
  expect(APP.slice(obsEnd, obsEnd + "}, [sid]);".length)).toBe("}, [sid]);");

  const follow = APP.indexOf("const switching = revealedSid !== sid;", obsEnd);
  const deps = APP.indexOf("stopGlide]);", follow);
  expect(follow).toBeGreaterThan(obsEnd);
  expect(APP.slice(follow, deps)).toContain("el.scrollTop = bottom;");
  expect(APP.slice(deps - 220, deps)).toContain("viewportHeight");
});

test("only the pane's height re-pins, so re-wrapping text cannot drag a reader down", () => {
  const obsAt = APP.indexOf("useLayoutEffect(() => {", APP.indexOf("// Publish the pane's own height"));
  const observer = APP.slice(obsAt, APP.indexOf("}, [sid]);", obsAt));

  expect(obsAt).toBeGreaterThan(0);
  expect(observer).not.toContain("clientWidth");
  expect(observer).not.toContain("getBoundingClientRect");
});
