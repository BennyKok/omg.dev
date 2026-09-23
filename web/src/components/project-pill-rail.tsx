import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { NO_PROJECT_FILTER, projectFilterLabel } from "../lib/project-filter";

export type ProjectPill = {
  value: string;
  /** Shown on the pill, and used as its title and accessible name. */
  label: string;
  /**
   * Draw a square icon pill instead of the label.
   *
   * Only the no-project scope uses this, and it matches iOS, where the same
   * scope is a 34pt round plus at the head of the rail. A rail of folder
   * names with one entry that is not a folder name reads as a folder called
   * "No project"; the plus reads as "start something that has no folder yet",
   * which is what it does.
   */
  icon?: "plus";
};

/**
 * The pills for a set of project filter values.
 *
 * One owner for both rails. The phone rail and the desktop rail each built
 * this list themselves, so the plus pill's label and icon were written out
 * twice, and a change to either had to be made in two places to take effect
 * on both widths.
 *
 * `shortProject` is passed in because it belongs to the shell, not here.
 */
export function projectPillsFor(
  projectOptions: readonly string[],
  shortProject: (project: string) => string,
): ProjectPill[] {
  return projectOptions.map((project) => ({
    value: project,
    // The rail is the one place this scope is an icon, so the label says what
    // it does rather than naming an absence. Everywhere the scope is named in
    // prose — the menu, the sheet, the composer chip — it stays "No project".
    label:
      project === NO_PROJECT_FILTER
        ? "Chats without a project"
        : projectFilterLabel(project, shortProject),
    icon: project === NO_PROJECT_FILTER ? "plus" : undefined,
  }));
}

/** A scrollable view of the shell's project filter; owns no selection state. */
export function ProjectPillRail({ projects, value, onChange, touch = false }: {
  projects: ProjectPill[];
  value: string;
  onChange: (value: string) => void;
  /** Phone layout, as on iOS: swipe to scroll, so no arrows and no divider. */
  touch?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = viewport.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((old) => old.left === left && old.right === right ? old : { left, right });
  };
  const reveal = (button: HTMLElement) => {
    const el = viewport.current;
    if (!el) return;
    const box = button.getBoundingClientRect();
    const bounds = el.getBoundingClientRect();
    if (!bounds.width) return;
    if (box.left < bounds.left + 8) el.scrollLeft += box.left - bounds.left - 8;
    else if (box.right > bounds.right - 8) el.scrollLeft += box.right - bounds.right + 8;
    measure();
  };
  const projectKey = JSON.stringify(projects);
  useLayoutEffect(() => {
    const update = () => {
      const selected = content.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (selected) reveal(selected);
      measure();
    };
    update();
    const observer = new ResizeObserver(update);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [value, projectKey]);

  const move = (direction: number) => {
    const el = viewport.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(80, el.clientWidth * 0.75),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  return (
    <div role="group" aria-label="Filter sessions by project"
      className={`flex h-[50px] shrink-0 items-center ${touch ? "" : "border-b border-border"}`}
      onKeyDown={(event) => { if (event.key === "Tab") event.stopPropagation(); }}
      onWheel={(event) => event.stopPropagation()}>
      <div className="relative min-w-0 flex-1">
        <div ref={viewport} onScroll={measure}
          className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div ref={content} className="flex w-max items-center gap-2 px-2 py-1">
            {/* No "All" pill. It was the one entry here that named no folder,
                and iOS has never had one: its rail is the plus and the
                folders. Clearing the scope is the selected pill's own job
                now — press it again — so the row is folders and nothing
                else. */}
            {projects.map((project) => (
              <button key={project.value} type="button" aria-pressed={value === project.value}
                title={project.label} aria-label={project.icon ? project.label : undefined}
                onClick={() => onChange(project.value)}
                onFocus={(event) => reveal(event.currentTarget)}
                className={`h-[34px] shrink-0 rounded-full border outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary ${project.icon ? "flex w-[34px] items-center justify-center" : "max-w-[180px] truncate px-3.5 text-[13px] font-semibold"} ${value === project.value ? "border-[var(--border-strong)] bg-card text-foreground" : "border-transparent bg-secondary text-muted-foreground hover:text-foreground"}`}>
                {project.icon === "plus" ? <Plus className="size-4" /> : project.label}
              </button>
            ))}
          </div>
        </div>
        {edges.left && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-linear-to-r from-background to-transparent" />}
        {edges.right && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-linear-to-l from-background to-transparent" />}
      </div>
      {!touch && (edges.left || edges.right) && <div className="flex shrink-0 pr-1">
        <button type="button" aria-label="Scroll projects left" disabled={!edges.left} onClick={() => move(-1)} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"><ChevronLeft className="size-4" /></button>
        <button type="button" aria-label="Scroll projects right" disabled={!edges.right} onClick={() => move(1)} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"><ChevronRight className="size-4" /></button>
      </div>}
    </div>
  );
}
