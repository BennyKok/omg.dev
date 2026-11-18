import { Folder } from "lucide-react";
import { cn } from "../lib/utils";
import { useProjectFavicon } from "../lib/session-ui";

/**
 * A folder's mark in a picker: the project's favicon, else the plain folder
 * icon. One component for the new-session chips, the phone Folders page and
 * the folder menu, so a project looks the same in each.
 */
export function ProjectMark({ project, className }: { project: string; className?: string }) {
  const { src, onLoad, onError } = useProjectFavicon(project);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        data-project-mark=""
        className={cn("size-3.5 shrink-0 rounded-[3px] object-contain", className)}
        onLoad={onLoad}
        onError={onError}
      />
    );
  }
  return <Folder aria-hidden="true" className={cn("size-3.5 shrink-0", className)} />;
}
