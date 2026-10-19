import { memo, type ReactNode } from "react";
import { Markdown } from "./markdown";

// FlatList owns the transcript's render window. A second, experimental
// VirtualView inside each row independently removes and restores its children,
// including the native menu host and its measured Markdown. Keep those children
// mounted for the row's lifetime so native visibility events cannot reset them.
export const virtualTranscriptBodiesSupported = false;

type Props = { text: string; streaming?: boolean; virtualize?: boolean; inHoldMenu?: boolean };

const MemoizedMarkdown = memo(function MemoizedMarkdown({ text, streaming, inHoldMenu }: Props) {
  return <Markdown text={text} streaming={streaming} inHoldMenu={inHoldMenu} />;
});

/** Compatibility boundary for existing callers and the transcript benchmark. */
export function VirtualBoundary({ children }: { enabled?: boolean; children: ReactNode }) {
  return <>{children}</>;
}

export function TranscriptBody({ text, streaming, inHoldMenu }: Props) {
  // Memoize the real chat path too: its menu caller passes virtualize={false}.
  // Background parent updates must not rebuild an unchanged attributed string.
  return <MemoizedMarkdown text={text} streaming={streaming} inHoldMenu={inHoldMenu} />;
}
