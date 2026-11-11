import { useCallback, useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SettingsIcon, SettingsRow } from "@/components/settings-ui";
import type { GlobalSettings } from "@/lib/global-settings";

export type SnapforkStatus = {
  supported: boolean;
  reason?: string;
  enabled: boolean;
  envOverride?: "on" | "off";
  forks: number;
  bases: number;
};

/**
 * Settings > Advanced. Snapshot workspaces are off by default. On, a new
 * session's worktree is a copy-on-write view of a shared project copy
 * (src/snapfork.ts) instead of a full checkout and install. The box reports
 * whether it can run them, so a machine without FUSE shows why the switch is
 * unavailable instead of a switch that silently does nothing. Renders one
 * row; the caller owns the card.
 */
export function SnapshotWorkspacesSettingsSection({
  settings,
  onChange,
  loadStatus = defaultLoadStatus,
}: {
  settings: Pick<GlobalSettings, "snapshotForks">;
  onChange: (patch: Partial<GlobalSettings>) => Promise<void>;
  loadStatus?: () => Promise<SnapforkStatus | null>;
}) {
  const [status, setStatus] = useState<SnapforkStatus | null>(null);
  const refresh = useCallback(() => {
    void loadStatus().then(setStatus).catch(() => setStatus(null));
  }, [loadStatus]);
  useEffect(refresh, [refresh]);

  // An older box has no /api/snapfork. Without a status the switch is hidden,
  // because nothing on that box would read the setting.
  if (!status) return null;

  const override = status.envOverride;
  const disabled = !status.supported || !!override;
  let note = "New sessions start from a shared copy of the project instead of a full checkout. They start faster and use far less disk.";
  if (!status.supported) note = `Not available on this machine. ${status.reason ?? ""}`.trim();
  else if (override) note = `Turned ${override} by LFG_SNAPFORK on this machine.`;
  else if (status.forks > 0) note = `${note} ${status.forks} active.`;

  return (
    <SettingsRow
      icon={<SettingsIcon><Copy /></SettingsIcon>}
      title="Snapshot workspaces"
      description={note}
      trailing={
        <Switch
          aria-label="Use snapshot workspaces for new sessions"
          checked={override ? status.enabled : settings.snapshotForks}
          disabled={disabled}
          onCheckedChange={(checked) =>
            void onChange({ snapshotForks: checked }).then(refresh, refresh)
          }
        />
      }
    />
  );
}

async function defaultLoadStatus(): Promise<SnapforkStatus | null> {
  const response = await fetch("/api/snapfork", { credentials: "same-origin" });
  if (!response.ok) return null;
  return (await response.json()) as SnapforkStatus;
}
