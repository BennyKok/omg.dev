import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { NO_PROJECT_FILTER } from "../lib/project-filter";
import { resetFolderActivityForTests } from "../lib/folder-activity";

const { MobileNewSessionButton, MobileNewSessionScreen } = await import("./mobile-home-composer");
let ui: Mounted;
beforeEach(() => {
  ui = mount();
  resetFolderActivityForTests(new Map());
});
afterEach(() => ui.cleanup());

const label = (value: string) => (value === NO_PROJECT_FILTER ? "No project" : value);

test("the home button opens the screen and raises the keyboard inside the tap", () => {
  let opened = 0;
  ui.render(<MobileNewSessionButton onOpen={() => opened++} />);
  expect(document.documentElement.style.getPropertyValue("--lfg-inline-composer-height")).toMatch(/px$/);
  const button = ui.queryAll("button").find((el) => el.textContent?.includes("New session"))!;
  ui.flush(() => button.click());
  expect(opened).toBe(1);
  // The stand-in field holds focus until the real field mounts.
  expect(document.activeElement?.tagName).toBe("INPUT");
});

test("the home button is out of reach under an open chat", () => {
  ui.render(<MobileNewSessionButton hidden onOpen={() => {}} />);
  const bar = ui.host.firstElementChild as HTMLElement;
  expect(bar.inert).toBe(true);
  expect(bar.getAttribute("aria-hidden")).toBe("true");
});

test("the screen lists No project first and picks a folder", () => {
  const picks: string[] = [];
  let closed = 0;
  let history = 0;
  ui.render(
    <MobileNewSessionScreen
      projects={[NO_PROJECT_FILTER, "lfg", "vibes"]}
      folder="lfg"
      labelFor={label}
      counts={new Map([["lfg", 4]])}
      onFolder={(value) => picks.push(value)}
      onClose={() => closed++}
      onHistory={() => history++}
    >
      <textarea aria-label="Prompt" />
    </MobileNewSessionScreen>,
  );
  const screen = document.querySelector('[data-testid="mobile-new-session"]')!;
  const rows = [...screen.querySelectorAll('[role="radio"]')];
  expect(rows.map((row) => row.textContent)).toEqual(["No project", "lfg4", "vibes"]);
  expect(rows[1].getAttribute("aria-checked")).toBe("true");
  ui.flush(() => (rows[2] as HTMLButtonElement).click());
  expect(picks).toEqual(["vibes"]);
  ui.flush(() => (screen.querySelector('[aria-label="Resume a session"]') as HTMLButtonElement).click());
  expect(history).toBe(1);
  ui.flush(() => (screen.querySelector('[aria-label="Close"]') as HTMLButtonElement).click());
  expect(closed).toBe(1);
  expect(screen.querySelector('[aria-label="Prompt"]')).not.toBeNull();
});

test("Escape closes the screen", () => {
  let closed = 0;
  ui.render(
    <MobileNewSessionScreen projects={["lfg"]} folder="lfg" labelFor={label} onFolder={() => {}} onClose={() => closed++}>
      <textarea aria-label="Prompt" />
    </MobileNewSessionScreen>,
  );
  const field = document.querySelector('[aria-label="Prompt"]') as HTMLTextAreaElement;
  ui.flush(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(closed).toBe(1);
});
