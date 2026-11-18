import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Copy, CornerDownLeft, Trash2, X } from "lucide-react";
import { MessageResponse } from "./ai-elements/message";
import { Button } from "./ui/button";
import { SlidePanel } from "./ui/slide-panel";
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
    const timer = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

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

  const content = (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-xs font-semibold text-foreground">/btw</span>
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
              className="size-7 rounded-full text-muted-foreground"
              onClick={onClear}
              disabled={streaming}
              aria-label="Clear side thread"
              title="Clear side thread"
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 rounded-full text-muted-foreground"
            onClick={onClose}
            aria-label="Close side question"
            title="Close (Esc)"
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      >
        {turns.length === 0 ? (
          <p className="my-auto px-2 text-center text-xs leading-relaxed text-muted-foreground">
            Ask a quick side question without adding to the main conversation.
          </p>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="flex flex-col gap-2">
              <div className="ml-6 self-end rounded-[18px] bg-accent/70 px-3 py-1.5 text-[13px] leading-snug text-foreground">
                {turn.question}
              </div>

              <div className="min-w-0 text-[13px] leading-relaxed text-foreground">
                {turn.error ? (
                  <p className="text-xs text-destructive">{turn.error}</p>
                ) : turn.answer ? (
                  <MessageResponse
                    className="markdown msg-text text-[13px] leading-relaxed"
                    mode={turn.streaming ? "streaming" : "static"}
                  >
                    {turn.answer}
                  </MessageResponse>
                ) : (
                  <span className="text-xs text-muted-foreground">Thinking…</span>
                )}

                {!turn.streaming && turn.answer ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 rounded-full px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => copyAnswer(turn)}
                    >
                      {copiedId === turn.id ? (
                        <>
                          <Check className="mr-1 size-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="mr-1 size-3" />
                          Copy
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 rounded-full px-2 text-[11px] text-primary hover:bg-primary/10 hover:text-primary"
                      onClick={() => onPromoteToMain(turn)}
                    >
                      <CornerDownLeft className="mr-1 size-3" />
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
        className="shrink-0 px-2.5 pb-2.5 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          submitDraft();
        }}
      >
        <div className="flex items-end gap-1.5 rounded-[22px] border border-border bg-[var(--stage-field,var(--card))] py-1.5 pl-3 pr-1.5 shadow-2xs focus-within:border-border-strong">
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
            placeholder={turns.length > 0 ? "Follow-up in /btw" : "Ask /btw"}
            className="max-h-24 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Button
            type="submit"
            size="icon"
            variant="default"
            disabled={streaming || !draft.trim()}
            className={cn(
              "size-7 shrink-0 rounded-full",
              !draft.trim() && "bg-accent text-muted-foreground opacity-60",
            )}
            aria-label="Ask side question"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </form>
    </div>
  );

  if (desktop) {
    if (!open) return null;
    return (
      <aside
        data-btw-drawer=""
        aria-label="Side question"
        className="flex min-h-0 w-80 shrink-0 flex-col border-l border-border bg-[var(--lfg-pane-bg,var(--background))] text-foreground @6xl:w-[340px]"
      >
        {content}
      </aside>
    );
  }

  return (
    <SlidePanel
      open={open}
      edge="bottom"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label="Side question"
      slot="btw-sheet"
      refreshKey={turns.length}
      className="inset-x-0 bottom-0 flex max-h-[78dvh] flex-col rounded-t-[20px] border-t border-border bg-[var(--stage-surface,var(--card))] pb-[var(--lfg-safe-bottom)] shadow-2xl"
    >
      <div className="flex shrink-0 justify-center pt-2 pb-1">
        <div className="h-1 w-9 rounded-full bg-border-strong/60" />
      </div>
      <div data-btw-drawer="" className="flex min-h-0 flex-1 flex-col">
        {content}
      </div>
    </SlidePanel>
  );
}
