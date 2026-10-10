import { Switch } from "@/components/ui/switch";
import type { GlobalSettings } from "@/lib/global-settings";

/**
 * Settings > Advanced. Fast mode is off by default, so a new user never sees
 * it. On shows the Fast mode switch in the composer's model picker for the
 * models that support it.
 */
export function FastModeSettingsSection({
  settings,
  onChange,
}: {
  settings: Pick<GlobalSettings, "showComposerFastMode">;
  onChange: (patch: Partial<GlobalSettings>) => Promise<void>;
}) {
  return (
    <section className="space-y-2">
      <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">Fast mode</div>
            <div className="text-xs text-muted-foreground">
              Show the Fast mode switch in the model picker. Only some models support it.
            </div>
          </div>
          <Switch
            aria-label="Show Fast mode in the composer"
            checked={settings.showComposerFastMode}
            onCheckedChange={(checked) => void onChange({ showComposerFastMode: checked })}
          />
        </div>
      </div>
    </section>
  );
}
