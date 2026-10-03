import { describe, expect, test } from "bun:test";
import { toRail, toStored } from "../mobile/src/omg/folder-arrangement";

const repos = [
  { name: "alpha", cwd: "/r/alpha", project: "alpha" },
  { name: "personal", cwd: "/r/beta", project: "beta" },
  { name: "gamma", cwd: "/r/gamma" },
];

describe("iOS folder rail arrangement stored on the machine", () => {
  test("maps stored project keys to the machine's cwds and drops unknown keys", () => {
    expect(toRail({ order: ["gamma", "web-only", "beta"], hidden: ["alpha", "gone"] }, repos)).toEqual({
      order: ["/r/gamma", "/r/beta"],
      hidden: ["/r/alpha"],
    });
  });

  test("writes project keys and keeps keys only the web menu knows", () => {
    expect(
      toStored(
        { order: ["/r/beta", "/r/alpha", "/r/gamma"], hidden: ["/r/gamma"] },
        repos,
        { order: ["alpha", "web-only"], hidden: ["web-hidden", "alpha"] },
      ),
    ).toEqual({ order: ["beta", "alpha", "gamma", "web-only"], hidden: ["gamma", "web-hidden"] });
  });
});

describe("iOS session list folder groups", () => {
  test("follow the saved folder order, then the label", async () => {
    const { groupNodesByProject } = await import("../mobile/src/omg/session-groups");
    const node = (project: string) => ({ session: { project } });
    const groups = groupNodesByProject(
      [node("afterglow"), node("vibes"), node("lfg")],
      () => 1,
      undefined,
      ["lfg", "vibes"],
    );
    expect(groups.map((group) => group.project)).toEqual(["lfg", "vibes", "afterglow"]);
  });
});
