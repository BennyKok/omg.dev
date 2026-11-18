import { expect, test } from "bun:test";
import { agentsThatNameFolders } from "./folder-options";

test("a switched-off auto agent no longer adds its folder; an active or running one does", () => {
  const agents = [
    { id: "on", enabled: true },
    { id: "off", enabled: false },
    { id: "off-but-running", enabled: false, running: true },
    { id: "unknown" },
  ];
  expect(agentsThatNameFolders(agents).map((a) => a.id)).toEqual(["on", "off-but-running", "unknown"]);
});
