// "From GitHub" on the Apps page: clone a repository onto this Computer
// (POST /api/repos/clone, src/repos-store.ts cloneRepo). It then lists under
// "On this computer" like any other project.

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { omgFetch } from "../lib/omg-client";

/** `owner/repo` is a GitHub repository; a full https:// or git@ address passes through. */
export function repositoryUrl(input: string): string {
  const text = input.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) return `https://github.com/${text.replace(/\.git$/, "")}.git`;
  return text;
}

export function ImportGitHubDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  /** The cloned folder, so the caller can open it. */
  onImported: (repo: { cwd: string; name: string }) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const url = repositoryUrl(value);
    if (!url || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await omgFetch("/api/repos/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await res.json().catch(() => null)) as { repo?: { cwd: string; name: string }; error?: string } | null;
      if (!res.ok || !body?.repo) throw new Error(body?.error || "The repository could not be copied.");
      await onImported(body.repo);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Import from GitHub</DialogTitle>
          <DialogDescription>Copy a repository onto this computer. A private repository needs GitHub access on this computer.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="owner/repo or https://github.com/owner/repo"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy || !value.trim()}>
            {busy ? "Importing…" : "Import"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
