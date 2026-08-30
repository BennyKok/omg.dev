// Human element inspection for the shared Computer browser.
//
// The picker runs inside the page because the person points through RFB while
// the agent controls the same tab over CDP. A transparent fixed capture layer
// receives pointer input without changing page layout or activating the page.
// The server stays the lifecycle owner: one controller, one active inspection,
// and one cleanup path for selection, Escape, timeout, abort and navigation.

export interface InspectionView {
  cdp(method: string, params?: unknown): Promise<unknown>;
  readonly url: string;
  readonly title: string;
}

export interface BrowserInspectionStatus {
  active: boolean;
  startedAt: number | null;
}

export interface BrowserInspectionOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface InspectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface CancelledInspection {
  status: "cancelled";
  reason: string;
}

interface SelectedInspection {
  status: "selected";
  selector: string;
  tagName: string;
  text: string;
  dom: {
    html: string;
    truncated: boolean;
    attributes: Record<string, string>;
    ancestors: Array<{ tagName: string; id?: string; classes?: string[] }>;
    previousSibling: { tagName: string; text: string } | null;
    nextSibling: { tagName: string; text: string } | null;
  };
  styles: Record<string, string>;
  accessibility: Record<string, string | boolean | null>;
  rect: Omit<InspectionRect, "scrollX" | "scrollY" | "viewportWidth" | "viewportHeight">;
  inspectionRect: InspectionRect;
  sourceHint?: {
    file?: string;
    line?: number;
    column?: number;
    component?: string;
  };
  frame?: {
    boundary: true;
    reason: string;
  };
}

export type BrowserInspectionResult =
  | CancelledInspection
  | (Omit<SelectedInspection, "inspectionRect"> & {
      page: { url: string; title: string };
      screenshotBase64?: string;
      screenshotError?: string;
      accessibility: Record<string, string | boolean | null>;
    });

interface ActiveInspection {
  token: string;
  startedAt: number;
  view: InspectionView;
  cancelReason: string | null;
  finished: Promise<void>;
  finish: () => void;
}

const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 75;

function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value!)));
}

export function captureClip(rect: InspectionRect, padding = 8) {
  const left = Math.max(0, rect.left - padding);
  const top = Math.max(0, rect.top - padding);
  const right = Math.min(rect.viewportWidth, rect.left + rect.width + padding);
  const bottom = Math.min(rect.viewportHeight, rect.top + rect.height + padding);
  return {
    x: rect.scrollX + left,
    y: rect.scrollY + top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    scale: 1,
  };
}

function pageInspectionScript(token: string, timeoutMs: number): string {
  const encodedToken = JSON.stringify(token);
  return `(() => {
    const key = Symbol.for("omg.dev.computer.inspect");
    const previous = globalThis[key];
    if (previous && typeof previous.cancel === "function") previous.cancel("replaced");
    const token = ${encodedToken};
    const timeoutMs = ${timeoutMs};
    const maxHtmlChars = 6000;
    const maxTextChars = 1200;
    const maxNodes = 80;
    const sensitive = /(?:password|passwd|secret|token|authorization|cookie|session|nonce|api[-_]?key)/i;
    const styleNames = [
      "display", "visibility", "position", "z-index", "box-sizing", "width", "height",
      "min-width", "min-height", "max-width", "max-height", "margin-top", "margin-right",
      "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom",
      "padding-left", "font-family", "font-size", "font-weight", "font-style", "line-height",
      "letter-spacing", "text-align", "text-decoration-line", "text-transform", "white-space",
      "color", "background-color", "background-image", "border-top-width", "border-right-width",
      "border-bottom-width", "border-left-width", "border-top-color", "border-right-color",
      "border-bottom-color", "border-left-color", "border-radius", "box-shadow", "opacity",
      "overflow-x", "overflow-y", "align-items", "justify-content", "gap", "grid-template-columns",
      "grid-template-rows", "flex-direction", "flex-grow", "flex-shrink", "transform"
    ];
    const escapeHtml = (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
    const cleanText = (value, max = maxTextChars) => String(value || "")
      .replace(/\\s+/g, " ")
      .trim()
      .slice(0, max);
    const isPrivateControl = (element) =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
    const safeAttribute = (name, value, element) => {
      if (sensitive.test(name) || name.toLowerCase() === "value") return "[redacted]";
      if (element instanceof HTMLInputElement && element.type === "password") return "[redacted]";
      return String(value).slice(0, 1000);
    };
    const attributesFor = (element) => Object.fromEntries(
      Array.from(element.attributes)
        .slice(0, 40)
        .map((attribute) => [
          attribute.name,
          safeAttribute(attribute.name, attribute.value, element)
        ])
    );
    const selectorFor = (element) => {
      const esc = (value) => CSS.escape(String(value));
      if (element.id) {
        const byId = "#" + esc(element.id);
        try { if (document.querySelectorAll(byId).length === 1) return byId; } catch {}
      }
      for (const name of ["data-testid", "data-test", "aria-label", "name"]) {
        const value = element.getAttribute(name);
        if (!value || sensitive.test(value)) continue;
        const candidate = element.localName + "[" + name + "=" + JSON.stringify(value) + "]";
        try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch {}
      }
      const parts = [];
      let current = element;
      for (let depth = 0; current && depth < 8; depth += 1) {
        let part = current.localName || "*";
        if (current.id) {
          part += "#" + esc(current.id);
          parts.unshift(part);
          break;
        }
        const classes = Array.from(current.classList).filter(Boolean).slice(0, 2);
        if (classes.length) part += classes.map((name) => "." + esc(name)).join("");
        const parent = current.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter((child) => child.localName === current.localName);
          if (sameTag.length > 1) part += ":nth-of-type(" + (sameTag.indexOf(current) + 1) + ")";
        }
        parts.unshift(part);
        const candidate = parts.join(" > ");
        try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch {}
        current = parent;
      }
      return parts.join(" > ").slice(0, 512);
    };
    const serialize = (root) => {
      let chars = 0;
      let nodes = 0;
      let truncated = false;
      const visit = (node, depth) => {
        if (chars >= maxHtmlChars || nodes >= maxNodes || depth > 5) {
          truncated = true;
          return "";
        }
        nodes += 1;
        if (node.nodeType === Node.TEXT_NODE) {
          const value = escapeHtml(cleanText(node.textContent, 500));
          chars += value.length;
          return value;
        }
        if (!(node instanceof Element)) return "";
        const tag = node.localName;
        const attrs = Object.entries(attributesFor(node))
          .map(([name, value]) => " " + name + '=\"' + escapeHtml(value) + '\"')
          .join("");
        let html = "<" + tag + attrs + ">";
        chars += html.length;
        if (isPrivateControl(node)) {
          const value = "[redacted]";
          html += value + "</" + tag + ">";
          chars += value.length + tag.length + 3;
          return html.slice(0, maxHtmlChars);
        }
        const children = Array.from(node.childNodes);
        for (let index = 0; index < children.length; index += 1) {
          if (index >= 20 || chars >= maxHtmlChars || nodes >= maxNodes) {
            truncated = true;
            break;
          }
          const child = visit(children[index], depth + 1);
          html += child;
          chars += child.length;
        }
        html += "</" + tag + ">";
        chars += tag.length + 3;
        return html.slice(0, maxHtmlChars);
      };
      const html = visit(root, 0).slice(0, maxHtmlChars);
      return { html, truncated: truncated || html.length >= maxHtmlChars };
    };
    const siblingSummary = (element) => element ? {
      tagName: element.tagName.toLowerCase(),
      text: cleanText(element.innerText || element.textContent, 240)
    } : null;
    const accessibilityFor = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const describedBy = element.getAttribute("aria-describedby");
      const labelledText = labelledBy ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ") : "";
      const describedText = describedBy ? describedBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ") : "";
      const labels = "labels" in element && element.labels ? Array.from(element.labels).map((label) => label.textContent || "").join(" ") : "";
      const fallbackText = isPrivateControl(element) ? "" : element.innerText;
      return {
        role: element.getAttribute("role"),
        name: cleanText(element.getAttribute("aria-label") || labelledText || labels || element.getAttribute("alt") || element.getAttribute("title") || fallbackText, 500),
        description: cleanText(describedText || element.getAttribute("aria-description"), 500),
        disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
        expanded: element.hasAttribute("aria-expanded") ? element.getAttribute("aria-expanded") === "true" : null,
        pressed: element.hasAttribute("aria-pressed") ? element.getAttribute("aria-pressed") === "true" : null,
        selected: element.hasAttribute("aria-selected") ? element.getAttribute("aria-selected") === "true" : null,
        checked: element.hasAttribute("aria-checked") ? element.getAttribute("aria-checked") : null
      };
    };
    const sourceFor = (element) => {
      const attrFile = element.getAttribute("data-source-file") || element.getAttribute("data-source") || element.getAttribute("data-file");
      const attrLine = Number(element.getAttribute("data-source-line") || 0) || undefined;
      const attrColumn = Number(element.getAttribute("data-source-column") || 0) || undefined;
      let component;
      let source;
      try {
        const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
        let fiber = key ? element[key] : null;
        for (let depth = 0; fiber && depth < 20; depth += 1, fiber = fiber.return) {
          if (!component) component = fiber.type?.displayName || fiber.type?.name;
          if (fiber._debugSource) { source = fiber._debugSource; break; }
        }
      } catch {}
      const file = attrFile || source?.fileName;
      const line = attrLine || source?.lineNumber;
      const column = attrColumn || source?.columnNumber;
      if (!file && !line && !column && !component) return undefined;
      return {
        ...(file ? { file: String(file).slice(0, 1000) } : {}),
        ...(line ? { line: Number(line) } : {}),
        ...(column ? { column: Number(column) } : {}),
        ...(component ? { component: String(component).slice(0, 200) } : {})
      };
    };
    const state = { token, result: null, cancel: null };
    globalThis[key] = state;
    {
      const capture = document.createElement("div");
      const highlight = document.createElement("div");
      const label = document.createElement("div");
      capture.dataset.omgComputerInspect = "capture";
      Object.assign(capture.style, {
        position: "fixed", inset: "0", zIndex: "2147483645", cursor: "crosshair",
        background: "transparent", touchAction: "none"
      });
      Object.assign(highlight.style, {
        position: "fixed", zIndex: "2147483646", pointerEvents: "none",
        border: "2px solid #22d3ee", background: "rgba(34, 211, 238, 0.12)",
        boxSizing: "border-box", borderRadius: "3px", display: "none"
      });
      label.textContent = "Select an element · Esc cancels";
      Object.assign(label.style, {
        position: "fixed", left: "50%", top: "12px", transform: "translateX(-50%)",
        zIndex: "2147483647", pointerEvents: "none", padding: "8px 12px",
        borderRadius: "999px", background: "#111827", color: "#ffffff",
        font: "600 13px/1.25 system-ui, sans-serif", boxShadow: "0 4px 18px rgba(0,0,0,.35)"
      });
      let current = null;
      let frame = 0;
      let lastPoint = null;
      let settled = false;
      const elementAt = (x, y) => {
        capture.style.pointerEvents = "none";
        const element = document.elementFromPoint(x, y);
        capture.style.pointerEvents = "auto";
        return element;
      };
      const draw = () => {
        frame = 0;
        if (!lastPoint) return;
        current = elementAt(lastPoint.x, lastPoint.y);
        if (!current || current === document.documentElement) {
          highlight.style.display = "none";
          return;
        }
        const rect = current.getBoundingClientRect();
        Object.assign(highlight.style, {
          display: "block", left: rect.left + "px", top: rect.top + "px",
          width: rect.width + "px", height: rect.height + "px"
        });
      };
      const onMove = (event) => {
        lastPoint = { x: event.clientX, y: event.clientY };
        if (!frame) frame = requestAnimationFrame(draw);
      };
      const cleanup = () => {
        clearTimeout(timer);
        if (frame) cancelAnimationFrame(frame);
        capture.removeEventListener("pointermove", onMove, true);
        capture.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", draw, true);
        document.removeEventListener("scroll", draw, true);
        capture.remove();
        highlight.remove();
        label.remove();
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        state.result = value;
      };
      const cancel = (reason) => finish({ status: "cancelled", reason: String(reason || "cancelled") });
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel("escape");
      };
      const onClick = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const target = elementAt(event.clientX, event.clientY) || current;
        if (!target || !(target instanceof Element)) return;
        const rect = target.getBoundingClientRect();
        const style = getComputedStyle(target);
        const styles = Object.fromEntries(styleNames.map((name) => [name, style.getPropertyValue(name)]));
        const ancestors = [];
        let ancestor = target.parentElement;
        while (ancestor && ancestors.length < 6) {
          ancestors.push({
            tagName: ancestor.tagName.toLowerCase(),
            ...(ancestor.id ? { id: ancestor.id } : {}),
            ...(ancestor.classList.length ? { classes: Array.from(ancestor.classList).slice(0, 4) } : {})
          });
          ancestor = ancestor.parentElement;
        }
        const serialized = serialize(target);
        const isFrame = target instanceof HTMLIFrameElement;
        finish({
          status: "selected",
          selector: selectorFor(target),
          tagName: target.tagName.toLowerCase(),
          text: isPrivateControl(target) ? "[redacted]" : cleanText(target.innerText || target.textContent),
          dom: {
            ...serialized,
            attributes: attributesFor(target),
            ancestors,
            previousSibling: siblingSummary(target.previousElementSibling),
            nextSibling: siblingSummary(target.nextElementSibling)
          },
          styles,
          accessibility: accessibilityFor(target),
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          inspectionRect: {
            left: Math.max(0, rect.left),
            top: Math.max(0, rect.top),
            width: Math.max(1, Math.min(innerWidth, rect.right) - Math.max(0, rect.left)),
            height: Math.max(1, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)),
            scrollX, scrollY, viewportWidth: innerWidth, viewportHeight: innerHeight
          },
          ...(sourceFor(target) ? { sourceHint: sourceFor(target) } : {}),
          ...(isFrame ? { frame: { boundary: true, reason: "iframe contents are outside this page inspection boundary" } } : {})
        });
      };
      const timer = setTimeout(() => cancel("timeout"), timeoutMs);
      state.cancel = cancel;
      capture.addEventListener("pointermove", onMove, true);
      capture.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("resize", draw, true);
      document.addEventListener("scroll", draw, true);
      document.documentElement.append(capture, highlight, label);
    }
    return { started: true, token };
  })()`;
}

function pollInspectionScript(token: string): string {
  return `(() => {
    const key = Symbol.for("omg.dev.computer.inspect");
    const state = globalThis[key];
    if (!state || state.token !== ${JSON.stringify(token)}) return { state: "lost" };
    if (state.result == null) return { state: "pending" };
    const result = state.result;
    delete globalThis[key];
    return { state: "done", result };
  })()`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cdpValue<T>(response: unknown): T {
  const envelope = response as {
    result?: { value?: unknown; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };
  if (envelope.exceptionDetails) {
    throw new Error(
      envelope.exceptionDetails.exception?.description ||
        envelope.exceptionDetails.text ||
        "element inspection failed in the page",
    );
  }
  return envelope.result?.value as T;
}

async function computedAccessibility(
  selector: string,
  cdp: (method: string, params?: unknown) => Promise<unknown>,
) {
  try {
    const documentReply = (await cdp("DOM.getDocument", { depth: 0 })) as {
      root?: { nodeId?: number };
    };
    const nodeId = documentReply.root?.nodeId;
    if (!nodeId) return null;
    const queryReply = (await cdp("DOM.querySelector", { nodeId, selector })) as {
      nodeId?: number;
    };
    if (!queryReply.nodeId) return null;
    const tree = (await cdp("Accessibility.getPartialAXTree", {
      nodeId: queryReply.nodeId,
      fetchRelatives: false,
    })) as {
      nodes?: Array<{
        role?: { value?: unknown };
        name?: { value?: unknown };
        description?: { value?: unknown };
      }>;
    };
    const node = tree.nodes?.[0];
    if (!node) return null;
    return {
      computedRole: node.role?.value == null ? null : String(node.role.value),
      computedName: node.name?.value == null ? null : String(node.name.value).slice(0, 500),
      computedDescription:
        node.description?.value == null ? null : String(node.description.value).slice(0, 500),
    };
  } catch {
    return null;
  }
}

export class BrowserInspector {
  private active: ActiveInspection | null = null;
  private cdpTail: Promise<void> = Promise.resolve();

  constructor(private readonly getView: () => Promise<InspectionView>) {}

  status(): BrowserInspectionStatus {
    return {
      active: this.active !== null,
      startedAt: this.active?.startedAt ?? null,
    };
  }

  private async cdp<T>(view: InspectionView, method: string, params?: unknown): Promise<T> {
    const run = this.cdpTail.then(() => view.cdp(method, params));
    this.cdpTail = run.then(
      () => undefined,
      () => undefined,
    );
    return (await run) as T;
  }

  async inspect(options: BrowserInspectionOptions = {}): Promise<BrowserInspectionResult> {
    if (this.active) throw new Error("element inspection is already active");
    const view = await this.getView();
    if (this.active) throw new Error("element inspection is already active");

    const token = crypto.randomUUID();
    const timeoutMs = clampTimeout(options.timeoutMs);
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.active = {
      token,
      startedAt: Date.now(),
      view,
      cancelReason: null,
      finished,
      finish,
    };
    const onAbort = () => {
      const current = this.active;
      if (!current || current.token !== token) return;
      current.cancelReason = "request aborted";
      void this.signalCancel(current, current.cancelReason);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await this.cdp<unknown>(view, "Runtime.evaluate", {
        expression: pageInspectionScript(token, timeoutMs),
        returnByValue: true,
        userGesture: true,
      });
      const started = cdpValue<{ started?: boolean }>(response);
      if (!started?.started) throw new Error("the page did not start element inspection");
      const current = this.active?.token === token ? this.active : null;
      if (current && options.signal?.aborted && !current.cancelReason) {
        current.cancelReason = "request aborted";
      }
      if (current?.cancelReason) await this.signalCancel(current, current.cancelReason);

      let selection: CancelledInspection | SelectedInspection | null = null;
      while (!selection) {
        await delay(POLL_INTERVAL_MS);
        const pollResponse = await this.cdp<unknown>(view, "Runtime.evaluate", {
          expression: pollInspectionScript(token),
          returnByValue: true,
        });
        const poll = cdpValue<{
          state?: "pending" | "done" | "lost";
          result?: CancelledInspection | SelectedInspection;
        }>(pollResponse);
        if (poll?.state === "lost") {
          throw new Error("the page changed before an element was selected");
        }
        if (poll?.state === "done") selection = poll.result ?? null;
      }
      if (!selection || (selection.status !== "selected" && selection.status !== "cancelled")) {
        throw new Error("the page returned an invalid element inspection result");
      }
      if (selection.status === "cancelled") return selection;

      const { inspectionRect, ...element } = selection;
      const accessibility = await computedAccessibility(
        selection.selector,
        async (method, params) => await this.cdp(view, method, params),
      );
      const result: BrowserInspectionResult = {
        ...element,
        accessibility: {
          ...selection.accessibility,
          ...(accessibility ?? {}),
        },
        page: { url: view.url, title: view.title },
      };
      try {
        const screenshot = await this.cdp<{ data?: string }>(view, "Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
          clip: captureClip(inspectionRect),
        });
        if (!screenshot.data) throw new Error("Chrome returned no image data");
        result.screenshotBase64 = screenshot.data;
      } catch (error) {
        result.screenshotError =
          error instanceof Error ? error.message : "could not capture the selected element";
      }
      return result;
    } catch (error) {
      throw new Error(
        `element inspection is unavailable on this page: ${
          error instanceof Error ? error.message : "unknown browser error"
        }`,
      );
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      const current = this.active;
      if (current?.token === token) {
        this.active = null;
        current.finish();
      } else {
        finish();
      }
    }
  }

  private async signalCancel(current: ActiveInspection, reason: string): Promise<boolean> {
    try {
      const response = await this.cdp<unknown>(current.view, "Runtime.evaluate", {
        expression: `(() => { const state = globalThis[Symbol.for("omg.dev.computer.inspect")]; if (!state || state.token !== ${JSON.stringify(current.token)}) return false; state.cancel(${JSON.stringify(reason)}); return true; })()`,
        returnByValue: true,
      });
      return cdpValue<boolean>(response) === true;
    } catch {
      return false;
    }
  }

  async cancel(reason = "cancelled"): Promise<boolean> {
    const current = this.active;
    if (!current) return false;
    current.cancelReason = reason;
    const cancelled = await this.signalCancel(current, reason);
    await current.finished;
    return cancelled;
  }
}
