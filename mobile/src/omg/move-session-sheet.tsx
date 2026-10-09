import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Icon } from "../components";
import { Sheet } from "./sheet";
import { SheetScrollView } from "./sheet-scroll";
import { Text } from "./text";
import { useTheme } from "./theme";
import { useOmg, type Repo } from "./provider";

export function MoveSessionSheet({ visible, onClose, sessionId, currentProject, onMoved }: {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  currentProject?: string | null;
  onMoved: (result: { cwd: string; project: string }) => void;
}) {
  const { client, repos: cachedRepos } = useOmg();
  const { colors, type, space, radius } = useTheme();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || !client) return;
    let cancelled = false;
    setRepos(cachedRepos);
    setLoading(true);
    setError(null);
    void client.transport.request<{ repos: Repo[] }>("/api/repos")
      .then((result) => { if (!cancelled) setRepos(result.repos ?? []); })
      .catch((error) => { if (!cancelled) setError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, client, cachedRepos]);

  async function move(cwd: string | null) {
    if (!client || moving) return;
    setMoving(true);
    setError(null);
    try {
      const result = await client.transport.request<{ cwd: string; project: string }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cwd ? { cwd } : { unassigned: true }),
        },
      );
      onMoved(result);
      void client.listSessions().catch(() => {});
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setMoving(false);
    }
  }

  const destinations = [{ name: "No project", cwd: null, project: "" }, ...repos.map((repo) => ({
    name: repo.name, cwd: repo.cwd, project: repo.project ?? repo.name,
  }))];
  return (
    <Sheet visible={visible} onClose={() => { if (!moving) onClose(); }}>
      <View style={{ paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.lg }}>
        <Text style={{ ...type.headline, color: colors.text }}>Move to folder</Text>
        <Text style={{ ...type.body, color: colors.textSecondary }}>Keep this chat and its history. Future work uses the selected folder. Existing files stay where they are.</Text>
        {loading || moving ? <ActivityIndicator accessibilityLabel={moving ? "Moving session" : "Loading folders"} color={colors.textSecondary} /> : null}
        {error ? <Text accessibilityRole="alert" style={{ ...type.body, color: colors.danger }}>{error}</Text> : null}
        <SheetScrollView style={{ maxHeight: 350 }}>
          {destinations.map((folder) => {
            const selected = currentProject === folder.project;
            return (
              <Pressable key={folder.cwd ?? "unassigned"} accessibilityRole="button"
                accessibilityLabel={`Move to ${folder.name}`} accessibilityState={{ disabled: moving || loading || selected, selected }}
                disabled={moving || loading || selected} onPress={() => void move(folder.cwd)}
                style={{ padding: space.md, borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Icon ios={selected ? "checkmark" : "folder"} android={selected ? "check" : "folder"} size={18} color={colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.body, color: selected ? colors.textSecondary : colors.text }}>{folder.name}</Text>
                  {folder.cwd ? <Text numberOfLines={1} style={{ ...type.caption, color: colors.textSecondary }}>{folder.cwd}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </SheetScrollView>
      </View>
    </Sheet>
  );
}
