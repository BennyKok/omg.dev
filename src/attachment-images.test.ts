import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAttachments, isImageMime, readAsBase64 } from "./attachment-images.ts";

describe("extractAttachments", () => {
  const root = mkdtempSync(join(tmpdir(), "lfg-attachments-"));
  const uploads = join(root, "lfg-uploads");
  mkdirSync(uploads);
  const png = join(uploads, "shot.png");
  const pdf = join(uploads, "spec.pdf");
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(pdf, "%PDF-1.4");
  process.on("exit", () => rmSync(root, { recursive: true, force: true }));

  test("lifts the composer's trailing block into typed attachments and strips it from the text", () => {
    const prompt = `Wat staat hier op?\n\nAttached file:\n- Screenshot 1.png: ${png}`;
    const out = extractAttachments(prompt);
    expect(out.hadBlock).toBe(true);
    expect(out.cleanText).toBe("Wat staat hier op?");
    expect(out.attachments).toEqual([{ path: png, mime: "image/png", filename: "Screenshot 1.png" }]);
  });

  test("keeps PDFs typed as documents and skips files outside the upload dir, missing files and unknown types", () => {
    const prompt = [
      "Lees dit.",
      "",
      "Attached files:",
      `- spec.pdf: ${pdf}`,
      `- gone.png: ${join(uploads, "gone.png")}`,
      `- notes.txt: ${join(uploads, "notes.txt")}`,
      "- passwd: /etc/passwd",
    ].join("\n");
    const out = extractAttachments(prompt);
    expect(out.attachments.map((a) => a.mime)).toEqual(["application/pdf"]);
    expect(out.cleanText).toBe("Lees dit.");
  });

  test("a block it cannot fully parse, or one typed mid-message, is left alone", () => {
    expect(extractAttachments("Attached files:\n- broken line").hadBlock).toBe(false);
    const mid = `Attached files:\n- a.png: ${png}\n\nen dan nog tekst`;
    expect(extractAttachments(mid)).toEqual({ cleanText: mid, attachments: [], hadBlock: false });
  });

  test("helpers", () => {
    expect(isImageMime("image/webp")).toBe(true);
    expect(isImageMime("application/pdf")).toBe(false);
    expect(readAsBase64(png)).toBe("iVBORw==");
    expect(readAsBase64(join(uploads, "nope.png"))).toBeNull();
  });
});
