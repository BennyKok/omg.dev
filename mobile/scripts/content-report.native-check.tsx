/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
const View = ({ children }: any) => <div>{children}</div>;
mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  View, ScrollView: View, Modal: View, ActivityIndicator: () => <span>sending</span>,
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>,
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) => <textarea aria-label={accessibilityLabel} value={value} onInput={(e: any) => onChangeText(e.target.value)} />,
}));
mock.module("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
mock.module(resolve(import.meta.dir, "../src/omg/auth.ts"), () => ({ getAuthToken: async () => "test-token" }));
mock.module(resolve(import.meta.dir, "../src/omg/config.ts"), () => ({ CONTROLPLANE_ORIGIN: "https://backend.test" }));
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({ Text: View }));
mock.module(resolve(import.meta.dir, "../src/omg/menu.tsx"), () => ({ DropdownMenu: View }));
const { light, type, space } = await import("../src/omg/palette");
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: light, type, space }) }));
const { ContentReport } = await import("../src/omg/content-report");

test("in-app reporting sends only reviewed content and cannot acknowledge a failed delivery", async () => {
  const ui = mount();
  const originalFetch = globalThis.fetch;
  const sent: any[] = [];
  let accepted = false;
  globalThis.fetch = (async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json(accepted ? { reportId: "receipt" } : { error: "unavailable" }, { status: accepted ? 200 : 503 });
  }) as typeof fetch;
  try {
    ui.render(<ContentReport selection={{ source: "session", sourceId: "one", content: "Selected answer" }} onClose={() => {}} />);
    const note = ui.query('[aria-label="Report description"]') as HTMLTextAreaElement;
    const content = ui.query('[aria-label="Reported content"]') as HTMLTextAreaElement;
    expect(content.value).toBe("Selected answer");
    const send = ui.query('[aria-label="Send report"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await ui.flushAsync(async () => { note.value = "Review this"; note.dispatchEvent(new Event("input", { bubbles: true })); content.value = "Edited selection"; content.dispatchEvent(new Event("input", { bubbles: true })); });
    await ui.flushAsync(async () => { send.click(); });
    expect(sent).toEqual([{ source: "session", sourceId: "one", content: "Edited selection", note: "Review this", reason: "harmful" }]);
    expect(ui.text()).not.toContain("Report sent.");
    expect(send.disabled).toBe(false);
    accepted = true;
    await ui.flushAsync(async () => { send.click(); });
    expect(ui.text()).toContain("Report sent.");
  } finally { globalThis.fetch = originalFetch; ui.cleanup(); }
});
