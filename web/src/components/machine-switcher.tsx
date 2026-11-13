import { useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Copy,
  Layers,
  Laptop,
  Pencil,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import {
  LOCAL_MACHINE_ID,
  selectMachine,
  usePeerMachines,
  type MachineChoice,
  type PeerFleetNodeInfo,
} from "../lib/machines";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";

function peerStatusSubtitle(node: PeerFleetNodeInfo | undefined, url: string): string {
  if (!node) return url;
  if (!node.online) return node.error ? `Offline · ${node.error}` : "Offline";
  if (node.busyCount > 0) {
    return `${node.sessionCount} session${node.sessionCount === 1 ? "" : "s"} · ${node.busyCount} working`;
  }
  if (node.sessionCount > 0) {
    return `${node.sessionCount} session${node.sessionCount === 1 ? "" : "s"}`;
  }
  return "Online · Idle";
}

function PeerActionsDialog({
  mode,
  target,
  selfPairingCode,
  onClose,
  onAddPeer,
  onRenamePeer,
}: {
  mode: "add" | "rename";
  target?: MachineChoice | null;
  selfPairingCode?: string | null;
  onClose: () => void;
  onAddPeer: (input: {
    pairingCode?: string;
    name?: string;
    allowOffline?: boolean;
  }) => Promise<{ ok: true } | { ok: false; error: string; unreachable?: boolean }>;
  onRenamePeer: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [pairingInput, setPairingInput] = useState("");
  const [nameInput, setNameInput] = useState(mode === "rename" ? target?.name ?? "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [copiedSelf, setCopiedSelf] = useState(false);

  const close = () => {
    if (!busy) onClose();
  };

  const submitAdd = async (allowOffline = false) => {
    const trimmed = pairingInput.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onAddPeer({
        pairingCode: trimmed,
        name: nameInput.trim() || undefined,
        allowOffline,
      });
      if (!result.ok) {
        setError(result.error);
        setUnreachable(Boolean(result.unreachable));
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || !target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onRenamePeer(target.id, trimmed);
      if (!result.ok) {
        setError(result.error || "Could not rename machine.");
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="pointer-events-auto z-[190] sm:max-w-md"
        overlayClassName="pointer-events-auto z-[190]"
        innerClassName="gap-5 p-5"
        data-machine-dialog={mode}
      >
        <DialogHeader className="gap-1.5 pr-8">
          <DialogTitle>
            {mode === "rename" ? "Rename machine" : "Link remote omg.dev"}
          </DialogTitle>
          <DialogDescription>
            {mode === "rename"
              ? "Choose how this machine appears in your sidebar and switcher."
              : "Control sessions across devices from one sidebar or switch your workspace onto another machine."}
          </DialogDescription>
        </DialogHeader>

        {mode === "rename" ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitRename();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="machine-rename-input" className="text-xs font-medium text-muted-foreground">
                Machine name
              </label>
              <Input
                id="machine-rename-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={80}
                autoComplete="off"
                disabled={busy}
                placeholder="e.g. Mac Studio"
              />
            </div>
            {error ? (
              <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !nameInput.trim()}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAdd(false);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="peer-pairing-code" className="text-xs font-medium text-muted-foreground">
                Remote URL or pairing code
              </label>
              <Input
                id="peer-pairing-code"
                value={pairingInput}
                onChange={(e) => {
                  setPairingInput(e.target.value);
                  setUnreachable(false);
                }}
                autoComplete="off"
                disabled={busy}
                placeholder="https://studio.tailnet.ts.net#omg_peer_..."
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Copy the pairing code from the remote machine’s Settings &gt; Remote access, or enter its direct URL.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="peer-display-name" className="text-xs font-medium text-muted-foreground">
                Display name (optional)
              </label>
              <Input
                id="peer-display-name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={80}
                autoComplete="off"
                disabled={busy}
                placeholder="Auto-detected from remote machine"
              />
            </div>

            {selfPairingCode ? (
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    This computer’s pairing code
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(selfPairingCode);
                        setCopiedSelf(true);
                        window.setTimeout(() => setCopiedSelf(false), 1_500);
                      } catch {}
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {copiedSelf ? (
                      <>
                        <Check className="size-3.5 text-success" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <code className="mt-1 block truncate text-[11px] text-muted-foreground">
                  {selfPairingCode}
                </code>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                Cancel
              </Button>
              {unreachable ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void submitAdd(true)}
                >
                  Save offline anyway
                </Button>
              ) : null}
              <Button type="submit" disabled={busy || !pairingInput.trim()}>
                {busy ? "Linking…" : "Link machine"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MachineSwitcher({
  variant,
  collapsed = false,
  onSelect = selectMachine,
  onHostAction,
}: {
  variant: "rail" | "icon" | "nav";
  collapsed?: boolean;
  onSelect?: (choice: MachineChoice) => void;
  onHostAction?: () => void;
}) {
  const {
    self,
    peers,
    fleetNodes,
    unified,
    setUnified,
    active,
    addPeer,
    renamePeer,
    removePeer,
  } = usePeerMachines(true);
  const [dialogMode, setDialogMode] = useState<"add" | "rename" | null>(null);
  const [editingTarget, setEditingTarget] = useState<MachineChoice | null>(null);

  const localChoice: MachineChoice = {
    id: LOCAL_MACHINE_ID,
    name: self?.name || "This computer",
  };
  const allChoices: MachineChoice[] = [
    localChoice,
    ...peers.map((p) => ({ id: p.id, name: p.name })),
  ];
  const current = allChoices.find((c) => c.id === active.id) ?? localChoice;
  const isRemoteActive = current.id !== LOCAL_MACHINE_ID;
  if (variant === "rail" && peers.length === 0 && !isRemoteActive) {
    return null;
  }
  const CurrentIcon = isRemoteActive ? Server : Laptop;
  const currentLabel =
    peers.length > 0 && unified
      ? `${current.name} · Unified`
      : current.name;

  const nodeByPeerId = new Map(fleetNodes.map((n) => [n.id, n]));

  const trigger =
    variant === "icon" ? (
      <button
        type="button"
        aria-label={`Machine: ${current.name}. Change machine`}
        title={currentLabel}
        data-machine-switcher="icon"
        className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <CurrentIcon className="size-[18px]" />
      </button>
    ) : (
      <button
        type="button"
        aria-label={`Machine: ${current.name}. Change machine`}
        title={currentLabel}
        data-machine-switcher={variant === "nav" ? "nav" : "rail"}
        className={cn(
          "flex h-10 shrink-0 items-center rounded-lg text-left text-[13px] font-medium text-foreground transition-colors hover:bg-muted",
          collapsed ? "w-10 justify-center" : "w-full gap-2 px-2",
        )}
      >
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/[0.06]">
          <CurrentIcon className="size-4 text-foreground/70" />
          {peers.length > 0 && unified ? (
            <span
              className=" -right-0.5 -top-0.5 absolute size-2 rounded-full bg-emerald-500 ring-2 ring-background"
              aria-hidden="true"
            />
          ) : null}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 truncate">{currentLabel}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </button>
    );

  return (
    <div
      className={cn(
        variant === "rail" && "shrink-0 border-t border-border",
        variant === "rail" && (collapsed ? "flex justify-center py-2" : "px-2 py-2"),
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent
          side={variant === "rail" ? "top" : "bottom"}
          align="start"
          sideOffset={8}
          className="w-72 p-1.5"
          data-machine-menu=""
        >
          {peers.length > 0 ? (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Session fleet
                </DropdownMenuLabel>
                <DropdownMenuItem
                  data-machine-unified-toggle=""
                  onClick={() => setUnified(!unified)}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-primary/10 text-primary">
                    <Layers className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      Unified fleet sidebar
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      Show sessions from all {peers.length + 1} machines
                    </span>
                  </span>
                  {unified ? <Check className="size-4 shrink-0 text-primary" /> : null}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}

          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Active machine
            </DropdownMenuLabel>

            {/* Local box */}
            <div className="flex items-center gap-0.5">
              <DropdownMenuItem
                data-machine-option={LOCAL_MACHINE_ID}
                aria-current={current.id === LOCAL_MACHINE_ID ? "true" : undefined}
                onClick={() => {
                  if (current.id !== LOCAL_MACHINE_ID) onSelect(localChoice);
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2"
              >
                <span className="relative flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/[0.06]">
                  <Laptop className="size-4 text-foreground/70" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{localChoice.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    This computer (local)
                  </span>
                </span>
                {current.id === LOCAL_MACHINE_ID ? (
                  <Check className="size-4 shrink-0 text-primary" />
                ) : null}
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={`Edit ${localChoice.name}`}
                title={`Edit ${localChoice.name}`}
                data-machine-edit={LOCAL_MACHINE_ID}
                className="size-8 shrink-0 justify-center rounded-lg p-0 text-muted-foreground"
                onClick={() => {
                  onHostAction?.();
                  setEditingTarget(localChoice);
                  setDialogMode("rename");
                }}
              >
                <Pencil className="size-3.5" />
              </DropdownMenuItem>
            </div>

            {/* Linked remote peers */}
            {peers.map((peer) => {
              const selected = current.id === peer.id;
              const node = nodeByPeerId.get(peer.id);
              const online = node?.online ?? true;
              const choice: MachineChoice = { id: peer.id, name: node?.name || peer.name };
              return (
                <div key={peer.id} className="flex items-center gap-0.5">
                  <DropdownMenuItem
                    data-machine-option={peer.id}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => {
                      if (!selected) onSelect(choice);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2"
                  >
                    <span className="relative flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/[0.06]">
                      <Server className="size-4 text-foreground/70" />
                      <span
                        className={cn(
                          "-bottom-0.5 -right-0.5 absolute size-2 rounded-full ring-2 ring-background",
                          online ? "bg-emerald-500" : "bg-muted-foreground/50",
                        )}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{choice.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {peerStatusSubtitle(node, peer.url)}
                      </span>
                    </span>
                    {selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    aria-label={`Edit ${choice.name}`}
                    title={`Edit ${choice.name}`}
                    data-machine-edit={peer.id}
                    className="size-8 shrink-0 justify-center rounded-lg p-0 text-muted-foreground"
                    onClick={() => {
                      onHostAction?.();
                      setEditingTarget(choice);
                      setDialogMode("rename");
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    aria-label={`Unlink ${choice.name}`}
                    title={`Unlink ${choice.name}`}
                    data-machine-remove={peer.id}
                    className="size-8 shrink-0 justify-center rounded-lg p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      void removePeer(peer.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </DropdownMenuItem>
                </div>
              );
            })}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-machine-add=""
            onClick={() => {
              onHostAction?.();
              setEditingTarget(null);
              setDialogMode("add");
            }}
          >
            <Plus className="size-4" />
            Link remote omg.dev
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialogMode ? (
        <PeerActionsDialog
          mode={dialogMode}
          target={editingTarget}
          selfPairingCode={self?.pairingCode ?? null}
          onClose={() => setDialogMode(null)}
          onAddPeer={async (input) => {
            const res = await addPeer(input);
            return res.ok ? { ok: true } : res;
          }}
          onRenamePeer={renamePeer}
        />
      ) : null}
    </div>
  );
}
