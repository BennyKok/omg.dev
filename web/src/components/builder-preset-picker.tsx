import { APP_BUILDER_PRESET } from "../../../packages/protocol/src/builder-presets";

export function BuilderPresetPicker({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <div className="space-y-2">
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>Preset</span>
      <select aria-label="OMG Agent preset" value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg bg-muted px-3 py-2">
        <option value="">General</option>
        <option value={APP_BUILDER_PRESET}>App Builder</option>
      </select>
    </label>
    {value === APP_BUILDER_PRESET ? <p className="text-xs text-muted-foreground">Build with the selected model. Apex reviews code, then the builder fixes and verifies it.</p> : null}
  </div>;
}
