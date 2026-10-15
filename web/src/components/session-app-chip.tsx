/**
 * THE LINKED APP IN A SESSION HEADER.
 *
 * A project folder links to one hosted app through `.omg/project.json`. The
 * runtime puts that link on the repo list as `repo.deploy`. When the session's
 * project has one, the header shows the live URL as a chip, and the chip opens
 * the app actions.
 *
 * There is no picker here on purpose. Linking a folder to a different app makes
 * the next deploy replace that app, so the agent links (omg_link_app) and asks
 * when it is unsure. The user can only unlink, which is safe: the next deploy
 * then creates a new app.
 */
import { Copy, ExternalLink, Globe, LayoutGrid, Unlink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SessionAppLink = { slug: string; url: string; name?: string };

type RepoWithLink = { cwd: string; project?: string; deploy?: SessionAppLink };

/** The repo a session runs in: its folder, or the repo that holds its worktree. */
export function sessionAppRepo<R extends RepoWithLink>(
  session: { cwd?: string | null; project?: string | null },
  repos: readonly R[],
): R | undefined {
  const cwd = session.cwd?.trim();
  if (!cwd) return undefined;
  const byFolder = repos
    .filter((repo) => cwd === repo.cwd || cwd.startsWith(`${repo.cwd}/`))
    .sort((a, b) => b.cwd.length - a.cwd.length)[0];
  if (byFolder) return byFolder;
  // A worktree lives outside its repo folder. The project label still names it.
  return session.project ? repos.find((repo) => repo.project === session.project) : undefined;
}

export function consoleAppUrl(slug: string): string {
  return `https://console.omg.dev/apps/${encodeURIComponent(slug)}`;
}

export function SessionAppChip({
  link,
  onCopied,
  onUnlink,
}: {
  link: SessionAppLink;
  onCopied?: () => void;
  /** Ask, then unlink. The parent owns the confirmation and the request. */
  onUnlink?: () => void;
}) {
  const host = link.url.replace(/^https?:\/\//, "");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Linked app ${host}`}
            className="flex min-w-0 max-w-[16rem] shrink items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
          />
        }
      >
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
        <Globe className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{host}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{link.name || link.slug}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}>
            <ExternalLink />
            Open app
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.open(consoleAppUrl(link.slug), "_blank", "noopener,noreferrer")}>
            <LayoutGrid />
            Open in console
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void navigator.clipboard?.writeText(link.url).then(() => onCopied?.(), () => undefined);
            }}
          >
            <Copy />
            Copy link
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {onUnlink ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onUnlink}>
              <Unlink />
              Unlink
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
