import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { Session } from "../App";
const { RailItem } = await import("../App");
const { blockedSessionAction } = await import("../lib/session-ui");

let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

function renderRow(session: Session, latest: string, busy = false) {
  ui.render(<RailItem session={session} users={[]} userFilter="__all" busy={busy} latest={latest}
    active={false} cursored={false} pinned={false} topPinned={false} collapsed={false}
    onActivate={() => {}} onTogglePin={() => {}} />);
}

test("a blocked row names the fix instead of wearing a pause badge", () => {
  renderRow(
    { sessionId: "s1", title: "Review", managed: true, tmuxName: "s1", status: "blocked", statusReason: "provider_auth", statusDetail: null },
    "Not logged in · Please run /login",
  );
  expect(ui.text()).toContain("Sign in to continue · Not logged in · Please run /login");
  expect(ui.query('[aria-label="paused"]')).toBeNull();
  expect(ui.query('[aria-label="Review, waiting for you, read"]')).not.toBeNull();
});

test("a healthy row keeps its plain preview", () => {
  renderRow({ sessionId: "s2", title: "Hi", managed: true, tmuxName: "s2", status: "ok", statusReason: null, statusDetail: null }, "Done.");
  expect(ui.text()).toContain("Done.");
  expect(ui.text()).not.toContain("continue");
});

test("each block reason maps to the action that clears it", () => {
  const action = (statusReason: Session["statusReason"]) => blockedSessionAction({ status: "blocked", statusReason });
  expect(action("provider_auth")).toBe("Sign in to continue");
  expect(action("model_unavailable")).toBe("Pick a model to continue");
  expect(action("out_of_credits")).toBe("Add credits to continue");
  expect(action("provider_error")).toBe("Open to retry");
  expect(action("interrupted")).toBe("Open to continue");
  expect(action(null)).toBe("Waiting for you");
  expect(blockedSessionAction({ status: "ok", statusReason: null })).toBeNull();
});
