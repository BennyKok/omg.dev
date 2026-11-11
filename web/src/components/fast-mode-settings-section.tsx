import { Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SettingsIcon, SettingsRow } from "@/components/settings-ui";
import type { GlobalSettings } from "@/lib/global-settings";

/**
 * Settings > Advanced. Fast mode is off by default, so a new user never sees
 * it. On shows the Fast mode switch in the composer's model picker for the
 * models that support it. Renders one row; the caller owns the card.
 */
export function FastModeSettingsSection({
  settings,
  onChange,
}: {
  settings: Pick<GlobalSettings, "showComposerFastMode">;
  onChange: (patch: Partial<GlobalSettings>) => Promise<void>;
}) {
  return (
    <SettingsRow
      icon={<SettingsIcon><Zap /></SettingsIcon>}
      title="Fast mode"
      description="Show the Fast mode switch in the model picker. Only some models support it."
      trailing={
        <Switch
          aria-label="Show Fast mode in the composer"
          checked={settings.showComposerFastMode}
          onCheckedChange={(checked) => void onChange({ showComposerFastMode: checked })}
        />
      }
    />
  );
}
