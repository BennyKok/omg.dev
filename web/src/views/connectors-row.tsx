import { Shield } from "lucide-react";
import { SettingsIcon, SettingsRow } from "@/components/settings-ui";

// Kept apart from connectors-page so Settings can render this row without
// pulling the whole Connectors page into the eager bundle. The page itself is
// loaded on demand from App.tsx.
/** The Settings row that opens this page. The caller owns the card. */
export function ConnectorsRow({ onOpen, roleCount }: { onOpen: () => void; roleCount: number | null }) {
  return (
    <SettingsRow
      onClick={onOpen}
      icon={<SettingsIcon><Shield /></SettingsIcon>}
      title={<>Roles &amp; tool access</>}
      description={roleCount === null ? "Which tools each session may use" : `${roleCount} role${roleCount === 1 ? "" : "s"}`}
      descriptionClassName="truncate"
    />
  );
}
