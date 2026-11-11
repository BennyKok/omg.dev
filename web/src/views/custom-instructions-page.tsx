import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";

import { SettingsIcon, SettingsRow } from "@/components/settings-ui";
import { Textarea } from "@/components/ui/textarea";

// Mirrors CUSTOM_INSTRUCTIONS_MAX_LENGTH in src/settings.ts. The server
// enforces it; this copy only stops the typing instead of failing the save.
export const CUSTOM_INSTRUCTIONS_MAX_LENGTH = 4000;

/** The Settings row that opens the page. The caller owns the card. */
export function CustomInstructionsRow({
  value,
  onOpen,
}: {
  value: string;
  onOpen: () => void;
}) {
  const preview = value.trim().split("\n")[0] ?? "";
  return (
    <SettingsRow
      onClick={onOpen}
      icon={<SettingsIcon><ScrollText /></SettingsIcon>}
      title="Custom instructions"
      description={preview || "Not set"}
      descriptionClassName="truncate"
    />
  );
}

/**
 * The page that edits the owner's standing instructions.
 *
 * Saved by an explicit action, not per keystroke: each save is a POST plus a
 * SQLite write, and prose would otherwise fire one per character.
 */
export function CustomInstructionsPage({
  value,
  onChange,
}: {
  value: string;
  onChange: (customInstructions: string) => Promise<void>;
}) {
  // `synced` is the last value we know the server holds. Comparing the draft
  // against the PROP instead would read a deliberate "" as untouched and
  // silently restore the old text, so clearing the field could never save.
  const [synced, setSynced] = useState(value);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (value === synced) return;
    setSynced(value);
    // Only an untouched field follows the server. An unsaved edit is the
    // human's and wins.
    setDraft((current) => (current === synced ? value : current));
  }, [value, synced]);

  const dirty = draft.trim() !== synced.trim();

  async function save() {
    if (!dirty || saving) return;
    const next = draft.trim();
    setSaving(true);
    setError(null);
    try {
      await onChange(next);
      setSynced(next);
      setDraft(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-3 pb-10" data-lfg-page-column>
      <div className="flex items-center justify-between px-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Custom instructions
        </h2>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="text-xs font-medium text-primary transition-opacity disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
        <Textarea
          aria-label="Custom instructions"
          value={draft}
          rows={14}
          maxLength={CUSTOM_INSTRUCTIONS_MAX_LENGTH}
          spellCheck={false}
          placeholder={"Always run the tests.\nAsk before you push."}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-64 rounded-none border-0 bg-transparent focus-visible:ring-0"
        />
      </div>

      <p className="px-4 text-xs text-muted-foreground">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : saved ? (
          "Saved."
        ) : (
          "Sent with every new session."
        )}
      </p>
    </div>
  );
}
