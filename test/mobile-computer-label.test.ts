import { describe, expect, test } from "bun:test";
import { bindingLabel, cloudComputerLabel } from "../mobile/src/omg/format";

describe("mobile computer names", () => {
  const machine = {
    id: "binding-12345678",
    computerUrl: "https://studio.example.com",
    defaultFolder: "/home/dev/repos/project",
  };

  test("uses the API name ahead of host and folder", () => {
    expect(bindingLabel({ ...machine, name: "  Benny’s Mac  " })).toBe("Benny’s Mac");
    expect(bindingLabel({ ...machine, name: "工作电脑" })).toBe("工作电脑");
  });

  test("keeps legacy fallbacks when the API has no name", () => {
    expect(bindingLabel(machine)).toBe("studio");
    expect(bindingLabel({ ...machine, name: "  " })).toBe("studio");
    expect(bindingLabel({ ...machine, computerUrl: "invalid" })).toBe("project");
    expect(bindingLabel({ id: machine.id })).toBe("binding-…");
  });

  test("uses cloud custom names and handles older or missing payloads", () => {
    expect(cloudComputerLabel({ name: "  My cloud  " })).toBe("My cloud");
    for (const cloud of [undefined, null, {}, { name: null }, { name: " " }]) {
      expect(cloudComputerLabel(cloud)).toBe("Cloud computer");
    }
  });
});
