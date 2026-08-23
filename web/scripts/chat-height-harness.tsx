/**
 * In-browser half of the chat row height fixture gate.
 *
 * It renders real transcript bubbles with the real Streamdown renderer inside
 * the real transcript DOM chain and the real compiled stylesheet, then reports
 * three things for each one:
 *   - the height the browser actually laid out,
 *   - the blocks streamdown's own splitter produced,
 *   - every text measurement the model asked pretext for.
 *
 * The last one is what lets the checked-in gate run under `bun test` with no
 * browser and no canvas: it replays the recorded measurements instead of
 * re-measuring glyphs. Everything else in the model — block classification,
 * margin collapsing, list and quote indents, code fence line counting, the
 * box arithmetic — is recomputed from scratch by the test and compared against
 * the recorded browser height.
 *
 * Driven by scripts/record-chat-height-fixture.ts (repo root). Not part of the app bundle.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { StreamdownResponse } from "@/components/ai-elements/streamdown-response";
import {
  ASSISTANT_ROOT_SELECTOR,
  ASSISTANT_ROW_CLASS,
  contentWidthAcross,
  markdownMetricsFor,
  pretextMeasurer,
} from "@/lib/markdown-metrics";
import { markdownHeight, type InlineRun, type TextMeasurer } from "@/lib/chat-row-height";
import { parseMarkdownIntoBlocks } from "streamdown";

type Sample = { id: string; text: string };

const CONTAINER_WIDTH = 720;

function Row({ text }: { text: string }) {
  return (
    <div className="pb-2">
      <div className="msg group/message flex w-full min-w-0 justify-start" data-role="assistant">
        <div className="message-actions-wrap relative flex min-w-0 max-w-[min(92%,calc(100%-2.25rem))] flex-col items-start">
          <div className="min-w-0 max-w-full">
            <div className="min-w-[3.5rem] max-w-full text-sm leading-relaxed">
              <StreamdownResponse mode="static">{text}</StreamdownResponse>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function measurementKey(
  kind: "plain" | "rich",
  payload: unknown,
  width: number,
  lineHeight: number,
): string {
  return JSON.stringify([kind, payload, Math.round(width * 100) / 100, lineHeight]);
}

/** pretext, with every question and answer written down. */
function recordingMeasurer(into: Record<string, number>): TextMeasurer {
  return {
    plain(text, font, width, lineHeight, letterSpacing) {
      const height = pretextMeasurer.plain(text, font, width, lineHeight, letterSpacing);
      into[measurementKey("plain", [text, font, letterSpacing ?? 0], width, lineHeight)] = height;
      return height;
    },
    rich(runs: InlineRun[], width, lineHeight) {
      const height = pretextMeasurer.rich(runs, width, lineHeight);
      into[measurementKey("rich", runs, width, lineHeight)] = height;
      return height;
    },
  };
}

/** Wait until nothing on the page changes height any more. Shiki highlights
 *  asynchronously, so a code block settles a frame or two after mount. */
async function settle(container: HTMLElement): Promise<void> {
  await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  let previous = -1;
  let stable = 0;
  for (let i = 0; i < 200; i += 1) {
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 25)));
    const height = container.scrollHeight;
    stable = height === previous ? stable + 1 : 0;
    previous = height;
    if (stable >= 8) return;
  }
}

async function main(): Promise<void> {
  const samples: Sample[] = await fetch("/samples.json").then((response) => response.json());

  const scroller = document.createElement("div");
  scroller.className = "chat-stream bg-background px-3 pt-3 pb-3";
  scroller.style.width = `${CONTAINER_WIDTH}px`;
  const content = document.createElement("div");
  content.className = "flex flex-col gap-2";
  scroller.appendChild(content);
  document.body.appendChild(scroller);

  createRoot(content).render(
    <StrictMode>
      {samples.map((sample) => (
        <Row key={sample.id} text={sample.text} />
      ))}
    </StrictMode>,
  );

  await settle(scroller);

  const roots = Array.from(content.querySelectorAll<HTMLElement>(".msg-text.markdown"));
  if (roots.length !== samples.length) {
    throw new Error(`expected ${samples.length} rendered bubbles, found ${roots.length}`);
  }

  const contentWidth = contentWidthAcross(roots);
  const metrics = markdownMetricsFor(scroller, ASSISTANT_ROW_CLASS, ASSISTANT_ROOT_SELECTOR, contentWidth);
  if (!metrics) throw new Error("could not probe markdown metrics");

  const measurements: Record<string, number> = {};
  const measure = recordingMeasurer(measurements);
  const rows = samples.map((sample, index) => {
    const blocks = parseMarkdownIntoBlocks(sample.text);
    const domHeight = roots[index].getBoundingClientRect().height;
    const modelHeight = markdownHeight(blocks, metrics, contentWidth, measure);
    // Per-child heights make a failure legible: a row that is 40px out says
    // nothing, one block that is 40px out says which rule is wrong.
    const children = Array.from(roots[index].children).map((child) => ({
      tag: child.tagName.toLowerCase(),
      height: (child as HTMLElement).getBoundingClientRect().height,
    }));
    return {
      id: sample.id,
      blocks,
      domHeight,
      modelHeight,
      children,
      rootWidth: roots[index].clientWidth,
    };
  });

  (window as unknown as { __CHAT_HEIGHT_FIXTURE__: unknown }).__CHAT_HEIGHT_FIXTURE__ = {
    recordedAt: new Date().toISOString(),
    contentWidth,
    metrics,
    measurements,
    rows,
  };
}

void main().catch((error) => {
  (window as unknown as { __CHAT_HEIGHT_ERROR__: string }).__CHAT_HEIGHT_ERROR__ = String(
    error?.stack ?? error,
  );
});
