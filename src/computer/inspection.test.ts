import { describe, expect, test } from "bun:test";
import { BrowserInspector, captureClip, type InspectionView } from "./inspection.ts";

function selected() {
  return {
    status: "selected" as const,
    selector: "#buy",
    tagName: "button",
    text: "Buy now",
    dom: {
      html: '<button id="buy">Buy now</button>',
      truncated: false,
      attributes: { id: "buy" },
      ancestors: [{ tagName: "main" }],
      previousSibling: null,
      nextSibling: null,
    },
    styles: { display: "block", color: "rgb(0, 0, 0)" },
    accessibility: { role: "button", name: "Buy now" },
    rect: { left: 10, top: 20, width: 100, height: 40 },
    inspectionRect: {
      left: 10,
      top: 20,
      width: 100,
      height: 40,
      scrollX: 0,
      scrollY: 200,
      viewportWidth: 800,
      viewportHeight: 600,
    },
    sourceHint: { file: "src/checkout.tsx", line: 42, component: "BuyButton" },
  };
}

describe("BrowserInspector", () => {
  test("returns bounded element context, computed accessibility and a cropped image", async () => {
    const calls: Array<{ method: string; params?: unknown }> = [];
    const view: InspectionView = {
      url: "https://shop.example/checkout",
      title: "Checkout",
      async cdp(method, params) {
        calls.push({ method, params });
        if (method === "Runtime.evaluate") {
          const expression = String((params as { expression?: string })?.expression ?? "");
          if (expression.includes("maxHtmlChars")) {
            return { result: { value: { started: true } } };
          }
          return { result: { value: { state: "done", result: selected() } } };
        }
        if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
        if (method === "DOM.querySelector") return { nodeId: 9 };
        if (method === "Accessibility.getPartialAXTree") {
          return {
            nodes: [
              {
                role: { value: "button" },
                name: { value: "Buy now" },
                description: { value: "Complete checkout" },
              },
            ],
          };
        }
        if (method === "Page.captureScreenshot") return { data: "cG5n" };
        throw new Error(`unexpected CDP call: ${method}`);
      },
    };
    const inspector = new BrowserInspector(async () => view);

    const result = await inspector.inspect({ timeoutMs: 30_000 });

    expect(result.status).toBe("selected");
    if (result.status !== "selected") throw new Error("expected a selected result");
    expect(result.page).toEqual({ url: view.url, title: view.title });
    expect(result.sourceHint).toEqual({
      file: "src/checkout.tsx",
      line: 42,
      component: "BuyButton",
    });
    expect(result.accessibility).toEqual({
      role: "button",
      name: "Buy now",
      computedRole: "button",
      computedName: "Buy now",
      computedDescription: "Complete checkout",
    });
    expect(result.screenshotBase64).toBe("cG5n");
    expect(inspector.status()).toEqual({ active: false, startedAt: null });
    expect(calls.find((call) => call.method === "Page.captureScreenshot")?.params).toEqual({
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: 2, y: 212, width: 116, height: 56, scale: 1 },
    });
    const script = String(
      (
        calls.find(
          (call) =>
            call.method === "Runtime.evaluate" &&
            String((call.params as { expression?: string })?.expression).includes("maxHtmlChars"),
        )?.params as { expression?: string }
      )?.expression,
    );
    expect(script).toContain('name.toLowerCase() === "value"');
    expect(script).toContain("maxHtmlChars = 6000");
  });

  test("allows one active inspection and cancels it through the page controller", async () => {
    const expressions: string[] = [];
    let cancelled = false;
    let cdpInFlight = false;
    const view: InspectionView = {
      url: "https://example.com",
      title: "Example",
      async cdp(method, params) {
        if (cdpInFlight) throw new Error("a cdp() is already pending");
        cdpInFlight = true;
        try {
          await Bun.sleep(5);
          if (method !== "Runtime.evaluate") throw new Error(`unexpected CDP call: ${method}`);
          const expression = String((params as { expression?: string })?.expression ?? "");
          expressions.push(expression);
          if (expression.includes("maxHtmlChars")) {
            return { result: { value: { started: true } } };
          }
          if (expression.includes("state.cancel")) {
            cancelled = true;
            return { result: { value: true } };
          }
          return {
            result: {
              value: cancelled
                ? { state: "done", result: { status: "cancelled", reason: "toolbar" } }
                : { state: "pending" },
            },
          };
        } finally {
          cdpInFlight = false;
        }
      },
    };
    const inspector = new BrowserInspector(async () => view);
    const pending = inspector.inspect();
    await Promise.resolve();

    expect(inspector.status().active).toBe(true);
    await expect(inspector.inspect()).rejects.toThrow("already active");
    expect(await inspector.cancel("toolbar")).toBe(true);
    await expect(pending).resolves.toEqual({ status: "cancelled", reason: "toolbar" });
    expect(expressions.some((expression) => expression.includes('state.cancel("toolbar")'))).toBe(
      true,
    );
    expect(inspector.status()).toEqual({ active: false, startedAt: null });
  });

  test("clears active state when the page rejects injected inspection", async () => {
    const inspector = new BrowserInspector(async () => ({
      url: "chrome://settings",
      title: "Settings",
      async cdp() {
        throw new Error("Refused to evaluate script");
      },
    }));

    await expect(inspector.inspect()).rejects.toThrow(
      "element inspection is unavailable on this page: Refused to evaluate script",
    );
    expect(inspector.status()).toEqual({ active: false, startedAt: null });
  });
});

describe("captureClip", () => {
  test("keeps the padded crop inside the visible viewport", () => {
    expect(
      captureClip({
        left: -20,
        top: 580,
        width: 70,
        height: 60,
        scrollX: 10,
        scrollY: 100,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({ x: 10, y: 672, width: 58, height: 28, scale: 1 });
  });
});
