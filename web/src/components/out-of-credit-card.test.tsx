import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { OutOfCreditCard, isOutOfCreditNotice, resetOutOfCreditHandoffs, OUT_OF_CREDIT_AUTO_OPEN_MS } =
  await import("./out-of-credit-card");
const { EmbeddedHostOptionsProvider } = await import("../lib/embedded-host-options");
type PlanLimitDetail = import("../lib/embedded-host-options").PlanLimitDetail;

// The exact sentence src/agents/backends/opencode-turn-recovery.ts writes.
const NOTICE =
  "You are out of AI credit, so the agent could not reply. Upgrade your plan or wait until your credit resets, then send your message again.";
const NOW = 1_800_000_000_000;

let ui: Mounted;
beforeEach(() => {
  ui = mount();
  resetOutOfCreditHandoffs();
});
afterEach(() => ui.cleanup());

function hosted(calls: PlanLimitDetail[], card: React.ReactNode) {
  return (
    <EmbeddedHostOptionsProvider value={{ defaultAgent: "omg", onPlanLimit: (d) => calls.push(d) }}>
      {card}
    </EmbeddedHostOptionsProvider>
  );
}

const card = () => ui.query('[data-testid="out-of-credit-card"]');

test("recognises the backend's out-of-credit turn and nothing else", () => {
  expect(isOutOfCreditNotice(NOTICE)).toBe(true);
  expect(isOutOfCreditNotice(`  ${NOTICE}\n`)).toBe(true);
  expect(isOutOfCreditNotice("Add a credit pack checkout to the billing page.")).toBe(false);
  expect(isOutOfCreditNotice("")).toBe(false);
});

test("a hosted surface shows an Upgrade card that hands the refusal to the host", () => {
  const calls: PlanLimitDetail[] = [];
  ui.render(hosted(calls, <OutOfCreditCard text={NOTICE} messageKey="m1" />));
  expect(card()).not.toBeNull();
  expect(ui.text()).toContain("You're out of AI credit");
  const upgrade = [...ui.queryAll("button")].find((b) => b.textContent === "Upgrade") as HTMLButtonElement;
  ui.flush(() => upgrade.click());
  expect(calls).toEqual([{ message: NOTICE, action: "out-of-credit" }]);
});

test("a fresh refusal opens the host's upgrade dialog once, without a tap", () => {
  const calls: PlanLimitDetail[] = [];
  const fresh = <OutOfCreditCard text={NOTICE} messageKey="m2" ts={NOW - 5_000} now={() => NOW} />;
  ui.render(hosted(calls, fresh));
  expect(calls).toHaveLength(1);
  expect(calls[0]!.action).toBe("out-of-credit");
  // Scrolling it out and back, or a re-render, must not reopen the dialog.
  ui.remount();
  ui.render(hosted(calls, fresh));
  expect(calls).toHaveLength(1);
});

test("an old refusal in the history does not open the dialog by itself", () => {
  const calls: PlanLimitDetail[] = [];
  ui.render(
    hosted(
      calls,
      <OutOfCreditCard text={NOTICE} messageKey="m3" ts={NOW - OUT_OF_CREDIT_AUTO_OPEN_MS - 1} now={() => NOW} />,
    ),
  );
  expect(calls).toHaveLength(0);
  expect(card()).not.toBeNull();
});

test("a standalone box with no host shows the sentence and no button", () => {
  ui.render(<OutOfCreditCard text={NOTICE} messageKey="m4" ts={NOW} now={() => NOW} />);
  expect(card()).toBeNull();
  expect(ui.text()).toContain(NOTICE);
  expect(ui.queryAll("button")).toHaveLength(0);
});
