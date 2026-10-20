/** Hidden composers must keep their drafts when the host fills a guide step. */
export function fillVisibleComposer(
  input: HTMLTextAreaElement | null,
  fill: (text: string) => void,
  text: string,
): boolean {
  if (!input?.isConnected) return false;
  const rect = input.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return false;
  fill(text);
  input.focus({ preventScroll: true });
  return true;
}
