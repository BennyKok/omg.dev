import { describe, expect, test } from "bun:test";

import {
  blockBox,
  classifyBlock,
  markdownHeight,
  type InlineRun,
  type TextMeasurer,
} from "./chat-row-height";
import type { MarkdownMetrics } from "./markdown-metrics";
import fixture from "./chat-row-height.fixture.json";

/**
 * The fixture gate: the height model against heights a real browser really
 * laid out, over real transcript bubbles.
 *
 * The fixture is recorded by `bun run scripts/record-chat-height-fixture.ts`,
 * which renders assistant markdown from a real agent transcript with the real
 * Streamdown renderer, the real compiled stylesheet and the real DOM chain in
 * a headless Chromium, and writes down what the browser measured.
 *
 * This test recomputes the model from scratch — block classification, margin
 * collapsing, list and quote indents, fence line counting, every box sum — and
 * compares it against those heights. The one thing it does not recompute is
 * glyph layout: pretext needs a canvas, `bun test` has none, so the recording
 * also captured every measurement the model asked for and this replays them.
 * A missing key therefore means the model changed WHICH text it measures, and
 * the fixture has to be recorded again; the test says so rather than silently
 * substituting a default.
 */

type Fixture = {
  recordedAt: string;
  contentWidth: number;
  metrics: MarkdownMetrics;
  measurements: Record<string, number>;
  rows: {
    id: string;
    blocks: string[];
    domHeight: number;
    modelHeight: number;
    children: { tag: string; height: number }[];
    rootWidth: number;
  }[];
};

const data = fixture as unknown as Fixture;

function measurementKey(
  kind: "plain" | "rich",
  payload: unknown,
  width: number,
  lineHeight: number,
): string {
  return JSON.stringify([kind, payload, Math.round(width * 100) / 100, lineHeight]);
}

const missing: string[] = [];

const replay: TextMeasurer = {
  plain(text, font, width, lineHeight, letterSpacing) {
    const key = measurementKey("plain", [text, font, letterSpacing ?? 0], width, lineHeight);
    const height = data.measurements[key];
    if (height == null) {
      missing.push(key);
      return lineHeight;
    }
    return height;
  },
  rich(runs: InlineRun[], width, lineHeight) {
    const key = measurementKey("rich", runs, width, lineHeight);
    const height = data.measurements[key];
    if (height == null) {
      missing.push(key);
      return lineHeight;
    }
    return height;
  },
};

function modelHeight(blocks: string[]): number {
  return markdownHeight(blocks, data.metrics, data.contentWidth, replay);
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

describe("chat row height against real browser layout", () => {
  test("the fixture is present and was recorded from real bubbles", () => {
    expect(data.rows.length).toBeGreaterThanOrEqual(100);
    expect(data.contentWidth).toBeGreaterThan(200);
    expect(data.metrics.blocks.p.lineHeight).toBeGreaterThan(0);
    // A fence card is the one box that cannot be probed synthetically, so the
    // recording must have caught a real one.
    expect(data.metrics.codeBlock).not.toBeNull();
  });

  test("every measurement the model asks for is in the fixture", () => {
    missing.length = 0;
    for (const row of data.rows) modelHeight(row.blocks);
    expect(
      missing.length === 0
        ? ""
        : `${missing.length} unrecorded measurements, first: ${missing[0]}\n` +
          "Re-record with: bun run scripts/record-chat-height-fixture.ts",
    ).toBe("");
  });

  test("the model tracks real layout across the corpus", () => {
    const errors = data.rows.map((row) => Math.abs(row.domHeight - modelHeight(row.blocks)));
    const sorted = [...errors].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const over8 = errors.filter((error) => error > 8).length;
    // One row in a hundred may be a whole line out. Text measurement is a
    // prediction of the browser's own line breaking, and a string that lands
    // within a pixel of the column edge breaks one way in pretext and the
    // other way in Blink. A whole line is 26px, so such a row can only ever
    // be counted, never trimmed.
    const allowedOver8 = Math.max(1, Math.ceil(data.rows.length * 0.01));
    const report =
      `median ${median.toFixed(2)}px p95 ${p95.toFixed(2)}px ` +
      `max ${sorted[sorted.length - 1].toFixed(2)}px over8 ${over8}/${data.rows.length}`;
    expect(`${median <= 1} ${p95 <= 4} ${over8 <= allowedOver8} ${report}`).toBe(
      `true true true ${report}`,
    );
  });

  test("no row is systematically wrong in one direction", () => {
    const signed = data.rows.map((row) => row.domHeight - modelHeight(row.blocks));
    const mean = signed.reduce((sum, value) => sum + value, 0) / signed.length;
    // A bias would compound over 1200 rows into a scrollbar that lies.
    expect(Math.abs(mean)).toBeLessThan(1.5);
  });

  test("each block kind is close on its own, not just on average", () => {
    // Block-level comparison localises a regression: a row that is 40px out
    // says nothing, one block that is 40px out says which rule broke.
    const worst = new Map<string, { error: number; source: string }>();
    for (const row of data.rows) {
      const blocks = row.blocks.filter((block) => block.trim().length > 0);
      if (blocks.length !== row.children.length) continue;
      blocks.forEach((block, index) => {
        const kind = classifyBlock(block).kind;
        const model = blockBox(classifyBlock(block), data.metrics, data.contentWidth, replay);
        const error = Math.abs(row.children[index].height - model.height);
        const current = worst.get(kind);
        if (!current || error > current.error) {
          worst.set(kind, { error, source: block.slice(0, 60) });
        }
      });
    }
    expect(worst.size).toBeGreaterThanOrEqual(5);
    const failures = [...worst]
      .filter(([, value]) => value.error > 30)
      .map(([kind, value]) => `${kind} off by ${value.error.toFixed(1)}px: ${value.source}`);
    expect(failures).toEqual([]);
  });

  test("the recorded model heights still reproduce", () => {
    // Guards the fixture itself: if this drifts, the recording and the code in
    // the tree no longer agree, and every threshold above is measuring the
    // wrong thing.
    for (const row of data.rows) {
      expect(modelHeight(row.blocks)).toBeCloseTo(row.modelHeight, 3);
    }
  });
});
