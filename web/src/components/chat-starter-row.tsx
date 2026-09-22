import { Globe, Image as ImageIcon, Smartphone, Terminal } from "lucide-react";
import { CHAT_STARTERS, type ChatStarterId } from "../../../packages/protocol/src/chat-starters";
import { cn } from "@/lib/utils";

/**
 * The four starter cards an empty no-project composer offers.
 *
 * The cards, and only the cards, are what a chat without a folder starts
 * from: there is no hero and no project setup form, because the agent creates
 * the project from the conversation itself (docs/no-project-chat.md). A tap
 * sends the starter prompt immediately, exactly as it does on iOS. It does
 * not fill the box and wait for a second tap on Start, which would put a
 * sentence the person did not write under their cursor.
 *
 * The prompts live in packages/protocol so the two clients cannot drift. Only
 * the icons are chosen here, because Lucide and SF Symbols do not share names.
 */
const STARTER_ICONS: Record<ChatStarterId, typeof Globe> = {
  website: Globe,
  app: Smartphone,
  api: Terminal,
  image: ImageIcon,
};

export function ChatStarterRow({
  onStart,
  disabled = false,
  className,
}: {
  /** Sends this text as a brand new chat. */
  onStart: (prompt: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Start something new"
      data-testid="chat-starter-row"
      className={cn("grid grid-cols-2 gap-2", className)}
    >
      {CHAT_STARTERS.map((starter) => {
        const Icon = STARTER_ICONS[starter.id];
        return (
          <button
            key={starter.id}
            type="button"
            disabled={disabled}
            data-testid={`chat-starter-${starter.id}`}
            aria-label={`Start ${starter.label.toLowerCase()}. ${starter.description}`}
            onClick={() => onStart(starter.prompt)}
            className="flex min-h-[64px] items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{starter.label}</span>
              <span className="block text-xs leading-tight text-muted-foreground">
                {starter.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
