import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { SnapshotWorkspacesSettingsSection } = await import("./snapshot-workspaces-settings-section");
import type { SnapforkStatus } from "./snapshot-workspaces-settings-section";

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const SWITCH = '[role="switch"][aria-label="Use snapshot workspaces for new sessions"]';
const status = (s: Partial<SnapforkStatus>) => async (): Promise<SnapforkStatus> => ({
  supported: true,
  enabled: false,
  forks: 0,
  bases: 0,
  ...s,
});

test("off by default; flipping it saves the opt-in", async () => {
  const patches: unknown[] = [];
  ui.render(
    <SnapshotWorkspacesSettingsSection
      settings={{ snapshotForks: false }}
      onChange={async (patch) => {
        patches.push(patch);
      }}
      loadStatus={status({})}
    />,
  );
  await ui.flushAsync();
  expect(ui.text()).toContain("Snapshot workspaces");
  const toggle = ui.query(SWITCH) as HTMLElement;
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  ui.flush(() => toggle.click());
  expect(patches).toEqual([{ snapshotForks: true }]);
});

test("an unsupported machine shows why and cannot turn it on", async () => {
  const patches: unknown[] = [];
  ui.render(
    <SnapshotWorkspacesSettingsSection
      settings={{ snapshotForks: false }}
      onChange={async (patch) => {
        patches.push(patch);
      }}
      loadStatus={status({ supported: false, reason: "This machine has no /dev/fuse." })}
    />,
  );
  await ui.flushAsync();
  expect(ui.text()).toContain("Not available on this machine. This machine has no /dev/fuse.");
  ui.flush(() => (ui.query(SWITCH) as HTMLElement).click());
  expect(patches).toEqual([]);
});

test("an environment override is shown and locks the switch", async () => {
  const patches: unknown[] = [];
  ui.render(
    <SnapshotWorkspacesSettingsSection
      settings={{ snapshotForks: false }}
      onChange={async (patch) => {
        patches.push(patch);
      }}
      loadStatus={status({ enabled: true, envOverride: "on" })}
    />,
  );
  await ui.flushAsync();
  expect(ui.text()).toContain("Turned on by LFG_SNAPFORK");
  const toggle = ui.query(SWITCH) as HTMLElement;
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  ui.flush(() => toggle.click());
  expect(patches).toEqual([]);
});

test("an older box without the status endpoint shows nothing", async () => {
  ui.render(
    <SnapshotWorkspacesSettingsSection
      settings={{ snapshotForks: false }}
      onChange={async () => {}}
      loadStatus={async () => null}
    />,
  );
  await ui.flushAsync();
  expect(ui.text()).not.toContain("Snapshot workspaces");
});
