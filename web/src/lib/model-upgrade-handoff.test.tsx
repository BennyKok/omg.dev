import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { EmbeddedHostOptionsProvider, useModelPlanErrorHandler, type PlanLimitDetail } from "./embedded-host-options";
let ui: Mounted;
afterEach(() => ui?.cleanup());

test("a wrapped model-plan error opens the host upgrade flow; provider errors remain errors", () => {
  ui = mount();
  const upgrades: PlanLimitDetail[] = [];
  let handler!: ReturnType<typeof useModelPlanErrorHandler>;
  function Fixture() { handler = useModelPlanErrorHandler(); return null; }
  ui.render(<EmbeddedHostOptionsProvider value={{ defaultAgent: "omg", connectionOnboarding: false,
    onPlanLimit: detail => upgrades.push(detail) }}><Fixture /></EmbeddedHostOptionsProvider>);
  expect(handler("APIError: 402 Upgrade your plan to use this model.")).toBe(true);
  expect(upgrades).toEqual([{ message: "Upgrade your plan to use this model.", action: "run-model" }]);
  expect(handler("The provider could not connect.")).toBe(false);
  expect(upgrades).toHaveLength(1);
});

test("a standalone surface retains the model error when no upgrade host is registered", () => {
  ui = mount();
  let handler!: ReturnType<typeof useModelPlanErrorHandler>;
  function Fixture() { handler = useModelPlanErrorHandler(); return null; }
  ui.render(<Fixture />);
  expect(handler("Upgrade your plan to use this model.")).toBe(false);
});
