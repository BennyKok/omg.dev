import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { skillCatalog, type SkillCatalog, type SkillCatalogItem } from "../lib/skill-catalog";

export function SkillSlashSuggest({
  active,
  agent,
  catalog = skillCatalog,
  onPick,
}: {
  active: { query: string } | null;
  agent?: string;
  catalog?: SkillCatalog;
  onPick: (skill: SkillCatalogItem) => void;
}) {
  const [snapshot, setSnapshot] = useState<{ agent?: string; items: SkillCatalogItem[] }>({ items: [] });
  const skills = snapshot.agent === agent ? snapshot.items : [];
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!active || !agent) return;
    let cancelled = false;
    catalog.list(agent)
      .then((items) => {
        if (!cancelled) setSnapshot({ agent, items });
      })
      .catch(() => {
        if (!cancelled) setSnapshot({ agent, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [active, agent, catalog]);

  useEffect(() => setSelected(0), [active?.query]);

  // Body text no longer ships with the catalog (it was 87% of its bytes), so
  // matching against a skill's prose happens on the box. Names still match
  // locally and instantly below — this only ADDS the deeper hits, debounced,
  // so the common case (type the skill's name) never waits on the network and
  // a slow or failed request can only mean "fewer results", never an empty
  // picker.
  const query = active?.query ?? "";
  const [deepHits, setDeepHits] = useState<{ agent?: string; q: string; items: SkillCatalogItem[] }>({
    q: "",
    items: [],
  });

  useEffect(() => {
    if (!active || !query || !agent) {
      setDeepHits({ q: "", items: [] });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      catalog.search(agent, query)
        .then((r) => {
          if (!cancelled) setDeepHits({ agent, q: query, items: r });
        })
        .catch(() => {
          if (!cancelled) setDeepHits({ agent, q: query, items: [] });
        });
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, query, agent, catalog]);

  const matches = useMemo(() => {
    if (!active) return [];
    const q = active.query;
    const local = skills.filter((skill) => {
      const haystack = `${skill.trigger} ${skill.name} ${skill.description}`.toLowerCase();
      return !q || haystack.includes(q);
    });
    if (!q) return local;
    // Name matches first, then body-only matches, so ranking stays stable as
    // the deeper results land underneath what is already on screen.
    const seen = new Set(local.map((skill) => `${skill.source}:${skill.trigger}`));
    const deeper =
      deepHits.agent === agent && deepHits.q === q
        ? deepHits.items.filter((skill) => !seen.has(`${skill.source}:${skill.trigger}`))
        : [];
    return [...local, ...deeper];
  }, [active, skills, deepHits, agent]);

  if (!active || !agent || !matches.length) return null;

  return (
    <div
      data-no-composer-swipe
      onWheel={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      data-composer-suggest=""
      className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <div className="max-h-[min(18rem,42dvh)] overflow-y-auto overscroll-contain p-1 touch-pan-y">
        {matches.map((skill, idx) => (
          <button
            key={`${skill.source}:${skill.trigger}`}
            type="button"
            data-skill-suggest-option
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => onPick(skill)}
            onMouseEnter={() => setSelected(idx)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
              idx === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                <span className="font-mono text-primary">/</span>
                {skill.trigger}
              </span>
              {skill.description ? (
                <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">
                  {skill.description}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {skill.source} skill
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
