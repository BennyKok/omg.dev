import { useEffect, useRef, useState } from "react";
import { Check, Copy, CornerDownLeft, Send, Trash2, X } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { BtwTurn } from "../lib/btw";

export function BtwDrawer({
  open,
  desktop,
  turns,
  streaming,
  onAsk,
  onClear,
  onClose,
  onPromoteToMain,
}: {
  open: boolean;
  desktop: boolean;
  turns: BtwTurn[];
  streaming: boolean;
  onAsk: (question: string) => void;
  onClear: () => void;
  onClose: () => void;
  onPromoteToMain: (turn: BtwTurn) => void;
}) {
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  if (!open) return null;

  function submitDraft() {
    const q = draft.trim();
    if (!q || streaming) return;
    setDraft("");
    onAsk(q);
  }

  function copyAnswer(turn: BtwTurn) {
    if (!turn.answer) return;
    void navigator.clipboard?.writeText(turn.answer);
    setCopiedId(turn.id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === turn.id ? null : prev));
    }, 1500);
  }

  return (
    <aside
      data-btw-drawer=""
      aria-label="Side question"
      className={cn(
        "flex min-h-0 flex-col bg-[var(--lfg-pane-bg,var(--background))] text-foreground",
        desktop
          ? "w-80 shrink-0 border-l border-border @6xl:w-[340px]"
          : "fixed inset-x-2 bottom-[calc(4.5rem+var(--lfg-safe-bottom))] z-40 max-h-[55dvh] rounded-2xl border border-border-strong bg-card shadow-2xl",
      )}
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">
            /btw
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {streaming ? "Answering…" : "Tools off · Not saved"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {turns.length > 0 ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 text-muted-foreground"
              onClick={onClear}
              disabled={streaming}
              aria-label="Clear side thread"
              title="Clear side thread"
            >
              <Trash2 className="size-3" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground"
            onClick={onClose}
            aria-label="Close side question"
            title="Close (Esc)"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5"
      >
        {turns.length === 0 ? (
          <div className="my-auto rounded-lg border border-dashed border-border bg-card/60 p-3 text-center text-[11.5px] leading-snug text-muted-foreground">
            Ask a quick side question without adding to the main chat.
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="flex flex-col gap-1.5">
              <div className="ml-5 self-end rounded-xl rounded-br-xs border border-border bg-card px-2.5 py-1.5 text-xs leading-snug text-foreground">
                {turn.question}
              </div>

              <div className="rounded-xl border border-border bg-card p-2.5 text-xs leading-relaxed text-foreground shadow-2xs">
                {turn.error ? (
                  <p className="text-[11.5px] text-destructive">{turn.error}</p>
                ) : turn.answer ? (
                  <div className="whitespace-pre-wrap break-words">{turn.answer}</div>
                ) : (
                  <span className="text-[11.5px] text-muted-foreground">Thinking…</span>
                )}

                {!turn.streaming && turn.answer ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border pt-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10.5px]"
                      onClick={() => copyAnswer(turn)}
                    >
                      {copiedId === turn.id ? (
                        <>
                          <Check className="mr-1 size-2.5" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="mr-1 size-2.5" />
                          Copy
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 text-[10.5px] text-primary"
                      onClick={() => onPromoteToMain(turn)}
                    >
                      <CornerDownLeft className="mr-1 size-2.5" />
                      Send to main chat
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        className="shrink-0 border-t border-border bg-card/80 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitDraft();
        }}
      >
        <div className="flex items-end gap-1.5 rounded-lg border border-border-strong bg-background px-2 py-1 focus-within:ring-1 focus-within:ring-ring">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={streaming}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onClose();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitDraft();
              }
            }}
            placeholder={turns.length > 0 ? "Follow-up in /btw…" : "Ask /btw…"}
            className="max-h-20 min-h-[24px] flex-1 resize-none bg-transparent py-0.5 text-xs leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Button
            type="submit"
            size="icon"
            variant="default"
            disabled={streaming || !draft.trim()}
            className="size-6 shrink-0 rounded-full"
            aria-label="Ask side question"
          >
            <Send className="size-3" />
          </Button>
        </div>
      </form>
    </aside>
  );
}
