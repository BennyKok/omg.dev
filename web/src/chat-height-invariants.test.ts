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
