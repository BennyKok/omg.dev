/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
const View = ({ children }: any) => <div>{children}</div>;
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  View,
  ActivityIndicator: () => <span>busy</span>,
  StyleSheet: { hairlineWidth: 1 },
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: any) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
}));
mock.module(import.meta.resolve("expo-symbols"), () => ({ SymbolView: ({ name }: any) => <i>{name}</i> }));
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({
  Text: View,
  TextInput: ({ value, onChangeText, secureTextEntry, accessibilityLabel }: any) => (
    <input
      aria-label={accessibilityLabel}
      type={secureTextEntry ? "password" : "text"}
      value={value}
      onChange={(e: any) => onChangeText(e.target.value)}
    />
  ),
}));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: {}, type: {}, space: {} }) }));
const { QuestionCard } = await import("../src/omg/question-card");

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test("an ask-user question has a dismiss button that closes it", async () => {
  const ui = mount();
  let dismissed = 0;
  try {
    ui.render(<QuestionCard question="Ship now?" options={[{ index: 0, label: "Yes" }]} onAnswer={() => {}} onDismiss={() => dismissed++} />);
    ui.query<HTMLButtonElement>('button[aria-label="Dismiss question"]')!.click();
    expect(dismissed).toBe(1);
    expect(ui.query('input[type="password"]')).toBeNull();
  } finally { ui.cleanup(); }
});

test("a native prompt has no dismiss button", () => {
  const ui = mount();
  try {
    ui.render(<QuestionCard question="Allow?" options={[{ index: 0, label: "Allow" }]} onAnswer={() => {}} />);
    expect(ui.query('button[aria-label="Dismiss question"]')).toBeNull();
  } finally { ui.cleanup(); }
});

test("a key request shows a password field and saves the typed value", async () => {
  const ui = mount();
  const saved: string[] = [];
  try {
    ui.render(
      <QuestionCard
        question="Enter IDEAS_PASSWORD"
        options={[]}
        onAnswer={() => {}}
        onDismiss={() => {}}
        secretKey="IDEAS_PASSWORD"
        onSaveSecret={async (value) => { saved.push(value); return true; }}
      />,
    );
    const input = ui.query<HTMLInputElement>('input[type="password"]')!;
    expect(input.getAttribute("aria-label")).toBe("Value for IDEAS_PASSWORD");
    const save = () => ui.query<HTMLButtonElement>('button[aria-label="Save IDEAS_PASSWORD"]')!;
    expect(save().disabled).toBe(true);
    await ui.flushAsync(async () => typeInto(input, "correct-horse-battery"));
    expect(save().disabled).toBe(false);
    await ui.flushAsync(async () => save().click());
    expect(saved).toEqual(["correct-horse-battery"]);
    expect(ui.query<HTMLInputElement>('input[type="password"]')!.value).toBe("");
  } finally { ui.cleanup(); }
});

test("a failed save keeps what was typed", async () => {
  const ui = mount();
  try {
    ui.render(<QuestionCard question="Enter K" options={[]} onAnswer={() => {}} secretKey="K" onSaveSecret={async () => false} />);
    const input = ui.query<HTMLInputElement>('input[type="password"]')!;
    await ui.flushAsync(async () => typeInto(input, "abc"));
    await ui.flushAsync(async () => ui.query<HTMLButtonElement>('button[aria-label="Save K"]')!.click());
    expect(ui.query<HTMLInputElement>('input[type="password"]')!.value).toBe("abc");
  } finally { ui.cleanup(); }
});
