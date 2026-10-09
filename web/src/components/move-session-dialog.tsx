import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";

type Repo = { name: string; cwd: string; project?: string };
export function MoveSessionDialog({ sessionId, currentProject, request, onClose, onMoved }: {
  sessionId: string;
  currentProject?: string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  onClose: () => void;
  onMoved: () => Promise<void>;
}) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void request<{ repos: Repo[] }>("/api/repos")
      .then((result) => { if (!cancelled) setRepos(result.repos ?? []); })
      .catch((error) => { if (!cancelled) setError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [request]);

  async function move(cwd: string | null) {
    if (moving) return;
    setMoving(true);
    setError(null);
    try {
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cwd ? { cwd } : { unassigned: true }),
      });
      await onMoved();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setMoving(false);
    }
  }
  const folders = [{ name: "No project", cwd: null, project: "" }, ...repos.map((repo) => ({
    ...repo, project: repo.project ?? repo.name,
  }))];
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !moving) onClose(); }}>
      <DialogContent showCloseButton={!moving}>
        <DialogHeader>
          <DialogTitle>Move to folder</DialogTitle>
          <DialogDescription>Keep this chat and its history. Future work uses the selected folder. Existing files stay where they are.</DialogDescription>
        </DialogHeader>
        {loading || moving ? <p role="status">{moving ? "Moving session…" : "Loading folders…"}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {folders.map((folder) => (
            <Button key={folder.cwd ?? "unassigned"} variant="outline" className="h-auto justify-start py-3 text-left"
              disabled={loading || moving || folder.project === currentProject}
              onClick={() => void move(folder.cwd)}>
              <span className="min-w-0">
                <span className="block">{folder.name}{folder.project === currentProject ? " (current)" : ""}</span>
                {folder.cwd ? <span className="block truncate text-xs text-muted-foreground">{folder.cwd}</span> : null}
              </span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
