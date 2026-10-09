import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { MicButton } from "./App";
import { BrowserTranscriptionSettings } from "./components/browser-transcription-settings";
import "./index.css";

function Prototype() {
  const [text, setText] = useState("");
  return <main className="mx-auto max-w-xl space-y-6 px-5 py-12">
    <div><p className="text-xs text-muted-foreground">omg.dev · Prototype</p><h1 className="mt-2 text-2xl font-semibold">Browser dictation</h1><p className="mt-2 text-sm text-muted-foreground">Start with cloud. Move to on-device transcription when Whistle is ready.</p></div>
    <section className="rounded-2xl border border-border bg-card"><BrowserTranscriptionSettings /></section>
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <label htmlFor="prototype-transcript" className="text-sm font-medium">Your message</label>
      <textarea id="prototype-transcript" className="min-h-40 w-full rounded-lg border border-border bg-background p-3 text-sm" placeholder="Tap the mic and speak…" value={text} onChange={(event) => setText(event.target.value)} />
      <div className="flex items-center gap-3"><MicButton className="size-10" baseText={text} onText={(transcript, base) => setText([base, transcript].filter(Boolean).join(" "))} onInterim={(transcript, base) => setText([base, transcript].filter(Boolean).join(" "))} onCancel={setText} /><p className="text-xs text-muted-foreground">Tap to record. Tap again to transcribe.</p></div>
    </section>
    <p className="text-xs text-muted-foreground">Cloud uses the existing omg.dev transcription service. Local works without sending audio to that service. English, German, French, Spanish, Italian, Dutch and Polish are supported locally.</p>
    <Toaster />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Prototype />);
