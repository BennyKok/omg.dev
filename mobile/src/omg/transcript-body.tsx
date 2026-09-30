import { memo, type ComponentType, type ReactNode } from "react";
import * as RN from "react-native";
import { Markdown } from "./markdown";

type VirtualBodyProps = { children?: ReactNode };

// Read the lazy native export only on native platforms. Older development
// clients and react-native-web keep the ordinary Markdown path.
const VirtualView = RN.Platform.OS !== "web" &&
  (RN.UIManager.hasViewManagerConfig?.("VirtualView") ||
    RN.UIManager.hasViewManagerConfig?.("VirtualViewExperimental"))
  ? (RN as unknown as { unstable_VirtualView?: ComponentType<VirtualBodyProps> }).unstable_VirtualView
  : undefined;

export const virtualTranscriptBodiesSupported = !!VirtualView;

type Props = { text: string; streaming?: boolean; virtualize?: boolean; inHoldMenu?: boolean };

// Keep the row, its entrance animation, disclosures, and modals outside this
// boundary. VirtualView unmounts children; it must not own durable UI state.
const VirtualMarkdown = memo(function VirtualMarkdown({ text, streaming, inHoldMenu }: Props) {
  const content = <Markdown text={text} streaming={streaming} inHoldMenu={inHoldMenu} />;
  return VirtualView ? <VirtualView>{content}</VirtualView> : content;
});

/**
 * The same boundary for callers that put something between it and the
 * markdown. A reply's hold menu hosts its child in SwiftUI (`RNHostView`), so
 * the VirtualView stays outside that host and measures the whole menu row.
 */
export function VirtualBoundary({ enabled = true, children }: { enabled?: boolean; children: ReactNode }) {
  return enabled && VirtualView ? <VirtualView>{children}</VirtualView> : <>{children}</>;
}

export function TranscriptBody({ text, streaming, virtualize = true, inHoldMenu }: Props) {
  // The unmodified path is also used by the native A/B benchmark.
  return virtualize
    ? <VirtualMarkdown text={text} streaming={streaming} inHoldMenu={inHoldMenu} />
    : <Markdown text={text} streaming={streaming} inHoldMenu={inHoldMenu} />;
}
