// How artifact bytes are handed to a browser.
//
// This is a security boundary, not formatting. `GET /api/artifacts/:id` serves
// agent-chosen bytes from the app's own origin, and the artifact route answers
// every "file" artifact with the attachment disposition this builds. That is
// what stops an agent-written `.html` or `.svg` from executing as the user:
// the browser saves it instead of interpreting it.

/**
 * Build an RFC 6266 `Content-Disposition`.
 *
 * The name comes from a source path the AGENT chose. It can hold quotes,
 * backslashes, control characters, CR/LF, or non-ASCII. A raw byte reaching
 * this header is a response-splitting bug, so nothing is interpolated
 * unescaped: the `filename` parameter is stripped to printable ASCII with the
 * quoting characters removed, and the real name is carried by the
 * percent-encoded `filename*`, which cannot contain a delimiter at all.
 */
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii =
    name
      // Everything outside printable ASCII, which removes CR, LF and NUL.
      .replace(/[^\x20-\x7e]/g, "_")
      // The two characters that could close or escape the quoted string.
      .replace(/["\\]/g, "_")
      .slice(0, 200)
      // A name that is only spaces is printable but is not a name.
      .trim() || "file";
  // encodeURIComponent leaves no delimiter, quote, or space unescaped.
  const encoded = encodeURIComponent(name).slice(0, 300);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
