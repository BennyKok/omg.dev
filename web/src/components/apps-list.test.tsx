// The Apps page lists published apps and folders on this Computer as one list.
// A folder worked on recently must sit above an app that was not, or the work
// a person is doing now drops below every app they ever published.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { AppItem, LocalProject, SessionLike } from "./apps-home";

const { default: AppsList } = await import("./apps-list");

let ui: Mounted;
beforeEach(() => {
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  ui = mount();
});
afterEach(() => ui.cleanup());

const hour = 3_600_000;
const session = (at: number): SessionLike => ({ sessionId: `s${at}`, project: "x", lastActivityAt: at });

const app = (name: string, at: number): AppItem<SessionLike> => ({
  project: name,
  link: { slug: name, name, url: `https://${name}.omgs.app` } as AppItem<SessionLike>["link"],
  name,
  iconUrl: null,
  isLive: true,
  kind: "app",
  sessions: at ? [session(at)] : [],
  lastActivityAt: at,
});
const folder = (name: string, at: number): LocalProject<SessionLike> => ({
  project: name,
  name,
  sessions: [session(at)],
  lastActivityAt: at,
});

function names(): string[] {
  return ui.queryAll("section span.truncate.font-semibold").map((node) => node.textContent ?? "");
}

test("apps and folders sort together by the last work on them", () => {
  const now = Date.now();
  ui.render(
    <AppsList apps={[app("todo", now - 5 * hour), app("snake", 0)]} local={[folder("vibes", now - hour)]} onOpenApp={() => {}} onOpenProject={() => {}} />,
  );
  expect(names()).toEqual(["vibes", "todo", "snake"]);
});

test("Published shows only apps, and Folders only folders", () => {
  const now = Date.now();
  ui.render(<AppsList apps={[app("todo", now - 5 * hour)]} local={[folder("vibes", now - hour)]} onOpenApp={() => {}} onOpenProject={() => {}} />);
  const press = (label: string) =>
    ui.flush(() => (ui.queryAll("button").find((b) => b.textContent === label) as HTMLButtonElement).click());
  press("Published");
  expect(names()).toEqual(["todo"]);
  press("Folders");
  expect(names()).toEqual(["vibes"]);
});
