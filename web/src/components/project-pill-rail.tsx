import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** A scrollable view of the shell's project filter; owns no selection state. */
export function ProjectPillRail({ projects, value, onChange }: {
  projects: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
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
      className="flex h-[50px] shrink-0 items-center border-b border-border"
      onKeyDown={(event) => { if (event.key === "Tab") event.stopPropagation(); }}
      onWheel={(event) => event.stopPropagation()}>
      <div className="relative min-w-0 flex-1">
        <div ref={viewport} onScroll={measure}
          className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div ref={content} className="flex w-max items-center gap-2 px-2 py-1">
            {[{ value: "__all", label: "All" }, ...projects].map((project) => (
              <button key={project.value} type="button" aria-pressed={value === project.value}
                title={project.label} onClick={() => onChange(project.value)}
                onFocus={(event) => reveal(event.currentTarget)}
                className={`h-[34px] max-w-[180px] shrink-0 truncate rounded-full border px-3.5 text-[13px] font-semibold outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary ${value === project.value ? "border-[var(--border-strong)] bg-card text-foreground" : "border-transparent bg-secondary text-muted-foreground hover:text-foreground"}`}>
                {project.label}
              </button>
            ))}
          </div>
        </div>
        {edges.left && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-linear-to-r from-background to-transparent" />}
        {edges.right && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-linear-to-l from-background to-transparent" />}
      </div>
      {(edges.left || edges.right) && <div className="flex shrink-0 pr-1">
        <button type="button" aria-label="Scroll projects left" disabled={!edges.left} onClick={() => move(-1)} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"><ChevronLeft className="size-4" /></button>
        <button type="button" aria-label="Scroll projects right" disabled={!edges.right} onClick={() => move(1)} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"><ChevronRight className="size-4" /></button>
      </div>}
    </div>
  );
}
