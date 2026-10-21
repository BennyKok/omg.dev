import { useState } from "react";
import { arrangeFolders, useFolderMenuPrefs } from "../lib/folder-menu-prefs";
import { NO_PROJECT_FILTER, projectFilterLabel } from "../lib/project-filter";
import { ManageFolders, type ProjectFolderMenuProps } from "./project-folder-menu";
import { ProjectPillRail, projectPillsFor } from "./project-pill-rail";
import { Drawer, DrawerContent, DrawerTitle } from "./ui/drawer";

export function MobileProjectFolders({
  projects, shortProject, value, onChange, canRemove, onRemove, onAddFolder, onNewFolder,
}: Pick<ProjectFolderMenuProps, "projects" | "value" | "onChange" | "canRemove" | "onRemove" | "onAddFolder" | "onNewFolder"> & {
  shortProject: (project: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const prefs = useFolderMenuPrefs();
  const closeThen = (action?: () => void) => action ? () => {
    setOpen(false);
    action();
  } : undefined;

  return <>
    <ProjectPillRail
      projects={projectPillsFor(projects, shortProject, { prefs, selected: value })}
      value={value}
      onChange={onChange}
      onManageFolders={() => setOpen(true)}
      touch
    />
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent className="mx-auto h-[min(70dvh,32rem)] max-w-lg overflow-hidden">
        <DrawerTitle className="sr-only">Manage folders</DrawerTitle>
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-[max(var(--lfg-safe-bottom),1rem)]">
          <ManageFolders
            folders={arrangeFolders(projects.filter((project) => project !== NO_PROJECT_FILTER && project !== "__all"), prefs)}
            labelFor={(project) => projectFilterLabel(project, shortProject)}
            canRemove={canRemove}
            onRemove={onRemove}
            onBack={() => setOpen(false)}
            onAddFolder={closeThen(onAddFolder)}
            onNewFolder={closeThen(onNewFolder)}
            touch
          />
        </div>
      </DrawerContent>
    </Drawer>
  </>;
}
