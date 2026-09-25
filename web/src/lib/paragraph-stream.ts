// Paragraph streaming for a live assistant reply.
//
// Token-by-token rendering repaints the markdown on every delta. It is harder
// to read and costs CPU on every connected device. A draft instead shows only
// the blocks that are complete; the partial block appears once it closes or
// the turn ends and the final message replaces the draft.
//
// A block is complete at a blank line. Headings, list items and table rows
// are single-line blocks, so they complete at their own newline; otherwise a
// long list would wait for the blank line after its last item. Inside a code
// fence every finished line is shown, so a long code block still grows.
//
// Kept in sync with mobile/src/omg/paragraph-stream.ts. The native app
// consumes @omg-dev/client from a release tarball, so the two clients each
// carry this small pure function instead of sharing it through the package.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LINE_BLOCK = /^ {0,3}(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|\|)/;

/** The prefix of `text` that ends at the last complete block. */
export function settledParagraphs(text: string): string {
  let cut = 0;
  let fence: string | null = null;
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf("\n", start);
    if (end < 0) break;
    const line = text.slice(start, end);
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length)) {
        fence = null;
      }
      cut = end + 1;
    } else if (marker) {
      fence = marker;
      cut = end + 1;
    } else if (!line.trim() || LINE_BLOCK.test(line)) {
      cut = end + 1;
    }
    start = end + 1;
  }
  return text.slice(0, cut).trimEnd();
}
