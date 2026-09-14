import { expect, mock, test } from "bun:test";
import React from "../node_modules/react";
import { renderToStaticMarkup } from "../node_modules/react-dom/server";
import { resolve } from "node:path";

mock.module(resolve(import.meta.dir, "../node_modules/react-native/index.js"), () => ({
  View: ({ children, accessibilityLabel }: any) => <div aria-label={accessibilityLabel}>{children}</div>,
  Image: ({ source }: any) => <img src={source.uri} />,
}));
mock.module(resolve(import.meta.dir, "../src/omg/text.tsx"), () => ({ Text: ({ children }: any) => <span>{children}</span> }));
mock.module(resolve(import.meta.dir, "../src/omg/theme.ts"), () => ({ useTheme: () => ({ colors: {}, type: { caption: {} } }) }));
const { HumanMessageFrame } = await import("../src/omg/human-message-frame");
const sender = { id: "human:alex", kind: "human" as const, role: "member" as const, joinedAt: 0, historyAccess: "all" as const, display: { name: "Alex", fallback: "Member", avatar: "https://example.com/alex.png" } };

test("own messages have no sender chrome", () => {
  expect(renderToStaticMarkup(<HumanMessageFrame sender={null}>My message</HumanMessageFrame>)).toBe("My message");
});
test("a single other-person message has a name, avatar and accessible attribution", () => {
  const html = renderToStaticMarkup(<HumanMessageFrame sender={sender}>Their message</HumanMessageFrame>);
  expect(html).toContain('aria-label="Message from Alex"');
  expect(html).toContain("<span>Alex</span>");
  expect(html).toContain('src="https://example.com/alex.png"');
  expect(html).toContain("Their message");
});
test("consecutive rows show the name first and avatar last", () => {
  const first = renderToStaticMarkup(<HumanMessageFrame sender={sender} lastOfRun={false}>First</HumanMessageFrame>);
  const last = renderToStaticMarkup(<HumanMessageFrame sender={sender} firstOfRun={false}>Last</HumanMessageFrame>);
  expect(first).toContain("<span>Alex</span>");
  expect(first).not.toContain("<img");
  expect(last).not.toContain("<span>Alex</span>");
  expect(last).toContain("<img");
});
test("missing profile photos retain the initial fallback", () => {
  const html = renderToStaticMarkup(<HumanMessageFrame sender={{ ...sender, display: { fallback: "Member" } }}>Message</HumanMessageFrame>);
  expect(html).toContain("<span>M</span>");
  expect(html).toContain("<span>Member</span>");
  expect(html).not.toContain("<img");
});
