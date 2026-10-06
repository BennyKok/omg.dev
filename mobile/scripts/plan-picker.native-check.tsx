/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(
  resolve(import.meta.dir, "../node_modules/react/index.js"),
  () => React,
);
const View = ({ children }: any) => <div>{children}</div>;
const Pressable = ({
  children,
  onPress,
  disabled,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  testID,
}: any) => (
  <button
    role={accessibilityRole}
    aria-label={accessibilityLabel}
    aria-checked={accessibilityState?.selected}
    data-testid={testID}
    disabled={disabled}
    onClick={onPress}
  >
    {children}
  </button>
);
mock.module(
  resolve(import.meta.dir, "../node_modules/react-native/index.js"),
  () => ({
    View,
    ScrollView: View,
    Image: () => null,
    ActivityIndicator: () => <span>Loading</span>,
    Pressable,
    Linking: { openURL: () => {} },
  }),
);
mock.module(import.meta.resolve("react-native-safe-area-context"), () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 20 }),
}));
mock.module(resolve(import.meta.dir, "../src/components.tsx"), () => ({
  Icon: () => <span>✓</span>,
  EmptyState: ({ title, detail }: any) => (
    <div>
      {title}
      {detail}
    </div>
  ),
  PrimaryButton: ({ label, onPress }: any) => (
    <button onClick={onPress}>{label}</button>
  ),
}));
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({
  Text: View,
}));
const { light, type, space } = await import("../src/omg/palette");
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({
  useTheme: () => ({ colors: light, type, space }),
}));
for (const name of ["plan-starter", "plan-personal", "plan-pro"])
  mock.module(
    resolve(import.meta.dir, `../assets/paywall/${name}.webp`),
    () => ({ default: 1 }),
  );
mock.module(
  resolve(import.meta.dir, "../assets/onboarding/plan-picnic.png"),
  () => ({ default: 1 }),
);
const { PlanPicker, selectedPlanProduct } = await import(
  "../src/omg/plan-picker"
);
import type { StoreProduct } from "../src/omg/store";
const products: StoreProduct[] = [
  {
    productId: "starter",
    plan: "computer_s40",
    label: "Starter Plus",
    displayPrice: "HK$148.00",
    specs: null,
  },
  {
    productId: "personal",
    plan: "computer_5",
    label: "Personal",
    displayPrice: "HK$298.00",
    specs: null,
  },
];
const props = {
  products,
  busy: false,
  canPurchase: true,
  onBuy: () => {},
  onRestore: () => {},
};
test("selection is separate from buying, and uses Apple's localized price verbatim", () => {
  const ui = mount();
  const bought: StoreProduct[] = [];
  try {
    ui.render(<PlanPicker {...props} onBuy={(p) => bought.push(p)} />);
    expect(ui.text()).toContain("Build your ideas.");
    expect(ui.text()).toContain("HK$148.00");
    expect(
      ui
        .query('[data-testid="plan-choice-computer_s40"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    ui.flush(() =>
      (
        ui.query('[data-testid="plan-choice-computer_5"]') as HTMLElement
      ).click(),
    );
    expect(bought).toHaveLength(0);
    expect(ui.text()).toContain("Continue with Personal");
    ui.flush(() =>
      (ui.query('[data-testid="plan-continue"]') as HTMLElement).click(),
    );
    expect(bought).toEqual([products[1]!]);
  } finally {
    ui.cleanup();
  }
});
test("current plans, busy purchases and web-billed accounts cannot be bought", () => {
  const ui = mount();
  try {
    for (const state of [
      { busy: true },
      { canPurchase: false },
      { products: [products[0]!], currentPlan: "computer_s40" },
    ]) {
      ui.render(<PlanPicker {...props} {...state} />);
      expect(
        (ui.query('[data-testid="plan-continue"]') as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    }
  } finally {
    ui.cleanup();
  }
});
test("an empty storefront has no purchase action and keeps restore and onboarding skip", () => {
  const ui = mount();
  let skipped = 0;
  let restored = 0;
  try {
    ui.render(
      <PlanPicker
        {...props}
        products={[]}
        onSkip={() => skipped++}
        onRestore={() => restored++}
      />,
    );
    expect(ui.text()).toContain("No plans available");
    expect(ui.query('[data-testid="plan-continue"]')).toBeNull();
    ui.flush(() => {
      const buttons = ui.queryAll("button");
      (
        buttons.find((b) => b.textContent === "Continue for now") as HTMLElement
      ).click();
      (
        buttons.find(
          (b) => b.textContent === "Restore purchases",
        ) as HTMLElement
      ).click();
    });
    expect(skipped).toBe(1);
    expect(restored).toBe(1);
  } finally {
    ui.cleanup();
  }
});
test("a removed selection and a one-product storefront always resolve to a returned product", () => {
  expect(selectedPlanProduct([], "missing")).toBeUndefined();
  expect(selectedPlanProduct([products[1]!], "starter")).toBe(products[1]!);
  expect(selectedPlanProduct(products, null, "computer_s40")).toBe(
    products[1]!,
  );
});
test("Pro appears only if returned by the store, and can be revealed before selection", () => {
  const ui = mount();
  const pro = {
    ...products[1]!,
    productId: "pro",
    plan: "computer_10",
    label: "Pro",
  };
  try {
    ui.render(<PlanPicker {...props} products={[...products, pro]} />);
    expect(ui.query('[data-testid="plan-choice-computer_10"]')).toBeNull();
    ui.flush(() =>
      (
        ui
          .queryAll("button")
          .find((b) => b.textContent === "See Pro") as HTMLElement
      ).click(),
    );
    expect(ui.query('[data-testid="plan-choice-computer_10"]')).not.toBeNull();
  } finally {
    ui.cleanup();
  }
});

// Exercise the screen's lifecycle branches with the existing flow boundary.
let flow: any = {
  phase: { kind: "ready" },
  products,
  account: { canPurchase: true, plan: null, tiers: products },
  busy: false,
  loadError: null,
  reload: () => {},
  restore: () => {},
  buy: () => {},
};
mock.module(resolve(import.meta.dir, "../src/omg/purchase-flow.ts"), () => ({
  usePurchaseFlow: () => flow,
  useAutoRun: () => {},
}));
mock.module(resolve(import.meta.dir, "../src/omg/store.ts"), () => ({
  isMockStore: false,
  setMockScenario: () => {},
}));
mock.module(resolve(import.meta.dir, "../src/omg/billing.ts"), () => ({
  setMockBillingScenario: () => {},
}));
mock.module(import.meta.resolve("expo-router"), () => ({
  useLocalSearchParams: () => ({}),
}));
const { default: PlanScreen } = await import("../app/plan");
test("Settings keeps loading, activation, success and web subscription states", () => {
  const ui = mount();
  const initial = flow;
  try {
    for (const [phase, expected] of [
      [{ kind: "loading" }, "Loading plans…"],
      [
        { kind: "unavailable", message: "Store not installed" },
        "Store not installed",
      ],
      [{ kind: "activating", plan: "computer_5" }, "Purchase complete"],
      [
        { kind: "done", entitlement: { plan: "computer_5", replayed: false } },
        "You're all set",
      ],
    ] as const) {
      flow = { ...initial, phase };
      ui.render(<PlanScreen />);
      expect(ui.text()).toContain(expected);
    }
    flow = {
      ...initial,
      account: {
        ...initial.account,
        canPurchase: false,
        reason: "stripe_subscription_active",
        plan: "computer_5",
      },
    };
    ui.render(<PlanScreen />);
    expect(ui.text()).toContain("You're subscribed through omg.dev on the web");
    expect(
      (ui.query('[data-testid="plan-continue"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  } finally {
    flow = initial;
    ui.cleanup();
  }
});
