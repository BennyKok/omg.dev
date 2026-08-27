/**
 * The real coding-agent marks.
 *
 * These are the same nine icons the web serves from web/public/agent-*.svg,
 * rasterised to PNG at 1x/2x/3x. React Native cannot render SVG without
 * react-native-svg, and that is a NATIVE module — adding it would mean a new
 * TestFlight build for what is otherwise an asset change. PNGs ride along with
 * an over-the-air update instead, so the icons reach the phone in a minute.
 *
 * The mapping mirrors agentIconSrc() in web/src/lib/session-ui.tsx exactly,
 * including its default: anything unrecognised (and `aisdk`, which is the
 * server's default agent) shows the Claude mark, because that is what the web
 * shows. Diverging here would make the same session look like a different agent
 * depending on which surface you opened it from.
 */

import type { ImageSourcePropType } from "react-native";

const CLAUDE = require("../../assets/agents/agent-claude.png") as ImageSourcePropType;

const BY_AGENT: Record<string, ImageSourcePropType> = {
  codex: require("../../assets/agents/agent-codex.png"),
  "codex-aisdk": require("../../assets/agents/agent-codex.png"),
  grok: require("../../assets/agents/agent-grok.png"),
  cursor: require("../../assets/agents/agent-cursor.png"),
  hermes: require("../../assets/agents/agent-hermes.png"),
  opencode: require("../../assets/agents/agent-opencode.png"),
  jcode: require("../../assets/agents/agent-jcode.png"),
  pi: require("../../assets/agents/agent-pi.png"),
  copilot: require("../../assets/agents/agent-copilot.png"),
};

export function agentIcon(agent?: string | null): ImageSourcePropType {
  const key = (agent ?? "").trim().toLowerCase();
  return BY_AGENT[key] ?? CLAUDE;
}

/** Display name, mirroring agentIconAlt() on the web. */
export function agentLabel(agent?: string | null): string {
  switch ((agent ?? "").trim().toLowerCase()) {
    case "codex":
    case "codex-aisdk":
      return "Codex";
    case "grok":
      return "Grok";
    case "cursor":
      return "Cursor";
    case "hermes":
      return "Hermes";
    case "opencode":
      return "OpenCode";
    case "jcode":
      return "Jcode";
    case "pi":
      return "pi";
    case "copilot":
      return "Copilot";
    default:
      return "Claude";
  }
}
