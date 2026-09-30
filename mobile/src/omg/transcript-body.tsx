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

type Props = { text: string; streaming?: boolean; virtualize?: boolean; selectable?: boolean };

// Keep the row, its entrance animation, disclosures, and modals outside this
// boundary. VirtualView unmounts children; it must not own durable UI state.
const VirtualMarkdown = memo(function VirtualMarkdown({ text, streaming, selectable }: Props) {
  const content = <Markdown text={text} streaming={streaming} selectable={selectable} />;
  return VirtualView ? <VirtualView>{content}</VirtualView> : content;
});

export function TranscriptBody({ text, streaming, virtualize = true, selectable }: Props) {
  // The unmodified path is also used by the native A/B benchmark.
  return virtualize
    ? <VirtualMarkdown text={text} streaming={streaming} selectable={selectable} />
    : <Markdown text={text} streaming={streaming} selectable={selectable} />;
}
