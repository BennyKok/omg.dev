import { describe, expect, test } from "bun:test";
import {
  computerInspectionDraft,
  inspectionPngBlob,
  mergeComputerInspectionDraft,
  type ComputerInspectionResult,
} from "./computer-inspection-draft";

describe("Computer inspection composer draft", () => {
  test("labels page data as untrusted, redacts URL values and leaves the instruction last", () => {
    const inspection: ComputerInspectionResult = {
      status: "selected",
      selector: "#checkout-panel",
      tagName: "section",
      page: {
        title: "Checkout",
        url: "https://example.test/checkout?token=secret&step=2#private",
      },
      dom: {
        html: '<section><input value="[redacted]"></section>',
      },
      styles: { display: "block" },
      accessibility: { computedRole: "region", computedName: "Checkout" },
      // The broad element text is intentionally excluded from the draft. DOM
      // controls already redact values and are the narrower inspection source.
      text: "never-emit-this-private-control-value",
    } as ComputerInspectionResult & { text: string };

    const draft = computerInspectionDraft(
      inspection,
      "/tmp/lfg-uploads/session-computer-design-mode.png",
    );

    expect(draft).toContain("untrusted page data");
    expect(draft).toContain("token=%5Bredacted%5D&step=%5Bredacted%5D");
    expect(draft).not.toContain("secret");
    expect(draft).not.toContain("never-emit-this-private-control-value");
    expect(draft).toContain('"selector": "#checkout-panel"');
    expect(draft).toContain('"screenshotPath": "/tmp/lfg-uploads/session-computer-design-mode.png"');
    expect(draft.endsWith("What I want changed:")).toBe(true);
  });

  test("bounds hostile or unexpectedly large page context", () => {
    const draft = computerInspectionDraft({
      status: "selected",
      selector: "main",
      dom: { html: "x".repeat(40_000) },
    });
    expect(draft.length).toBeLessThan(9_000);
    expect(draft).toContain("[inspection context truncated]");
  });

  test("preserves the person's existing instruction without nesting an older inspection", () => {
    const next = computerInspectionDraft({ status: "selected", selector: "#new" });
    expect(mergeComputerInspectionDraft(next, "Make it blue")).toBe(
      `${next}\nMake it blue`,
    );
    expect(
      mergeComputerInspectionDraft(
        next,
        "I selected this element in Computer Design Mode.\nWhat I want changed:\nKeep the spacing",
      ),
    ).toBe(`${next}\nKeep the spacing`);
  });

  test("decodes the crop into a PNG blob without retaining base64 in the draft", async () => {
    const blob = inspectionPngBlob("iVBORw0KGgo=");
    expect(blob.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(computerInspectionDraft({ status: "selected", screenshotBase64: "private-bytes" }))
      .not.toContain("private-bytes");
  });
});
