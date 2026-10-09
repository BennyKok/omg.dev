// Browser-only fixture. Uses the production drawer and its real consumers.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerClose, DrawerTrigger } from "../src/components/ui/drawer";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../src/components/ui/dropdown-menu";
import { FindingsSheet } from "../src/components/findings-pill";
import "../src/index.css";

function Check() {
  const [finding, setFinding] = useState(false);
  const [selection, setSelection] = useState("None");
  return <main className="p-6 text-foreground">
    <h1 className="mb-4 text-xl font-semibold">Drawer browser checks</h1>
    <p aria-live="polite">Selection: {selection}</p>
    <Drawer presentation="sheet" snapPoints={[240]}>
      <DrawerTrigger className="m-2 rounded-xl border p-3">Snap points</DrawerTrigger>
      <DrawerContent expandOnFocus={false} className="h-[600px] max-w-lg">
        <DrawerTitle>Snap point sheet</DrawerTitle><DrawerDescription>Swipe up to expand.</DrawerDescription>
        <div className="min-h-0 flex-1 overflow-auto">
          <DropdownMenu><DropdownMenuTrigger className="my-3 rounded-xl border p-3">Open nested menu</DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem onClick={() => setSelection("Codex")}>Choose Codex</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
          <Drawer presentation="sheet" layer={180}><DrawerTrigger className="m-2 rounded-xl border p-3">Open child sheet</DrawerTrigger>
            <DrawerContent><DrawerTitle>Child sheet</DrawerTitle><DrawerClose className="rounded-xl border p-3">Close child</DrawerClose></DrawerContent>
          </Drawer>
          {Array.from({length:25},(_,i)=><p key={i} className="p-3">Scrollable row {i+1}</p>)}
        </div><DrawerClose className="rounded-xl border p-3">Close snap sheet</DrawerClose>
      </DrawerContent>
    </Drawer>
    <Drawer presentation="sheet" dismissible={false}>
      <DrawerTrigger className="m-2 rounded-xl border p-3">Protected sheet</DrawerTrigger>
      <DrawerContent expandOnFocus={false}><DrawerTitle>Protected sheet</DrawerTitle><DrawerClose className="rounded-xl border p-3">Confirm close</DrawerClose></DrawerContent>
    </Drawer>
    <Drawer><DrawerTrigger className="m-2 rounded-xl border p-3">Responsive drawer</DrawerTrigger>
      <DrawerContent><DrawerTitle>Responsive drawer</DrawerTitle><input className="my-4 rounded-xl border p-3" aria-label="Search" placeholder="Search"/><DrawerClose>Close responsive drawer</DrawerClose></DrawerContent>
    </Drawer>
    <button className="m-2 rounded-xl border p-3" onClick={()=>setFinding(true)}>Open updates</button>
    <FindingsSheet open={finding} onOpenChange={setFinding} count={30}>
      {Array.from({length:30},(_,i)=><button className="min-h-12 border-b p-3 text-left" key={i}>Update {i+1}</button>)}
    </FindingsSheet>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Check />);
