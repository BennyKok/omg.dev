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
