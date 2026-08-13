/**
 * Switching which Computer this app talks to — a native action sheet rather
 * than a screen push, because choosing between two machines never justified a
 * whole navigation transition. Every call site shares this one menu instead of
 * hand-rolling its own list.
 *
 * Switching is not managing: pairing, per-machine detail and the blocked-plan
 * escape hatch still live on app/computers.tsx, which this menu's last entry
 * pushes to. See the note above that entry for why both have to exist.
 *
 * The one thing this menu must not do is let you pick a machine that cannot
 * serve you. The account's cloud Computer can come back
 * status:"upgrade_required" / blockedReason:"plan_downgraded" — observed live —
 * and the session proxy then answers every request with a permanent 425. If
 * that row looks pickable, the app sends you to a spinner that never ends. So
 * a blocked machine is listed disabled, with its reason folded into the label
 * and a way out to the web where billing actually lives.
 */
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect } from "react";
import { Linking } from "react-native";

import { CLOUD_BINDING_ID } from "./config";
import { bindingLabel, cloudStatusLabel, relativeTime } from "./format";
import { showActionMenu, type MenuAction } from "./native-menu";
import { useOmg } from "./provider";
import { useToast } from "./toast";

const BLOCKED_CLOUD_STATUSES = new Set(["upgrade_required", "recycled"]);

export function useComputerPicker() {
  const router = useRouter();
  const { bindings, cloud, bindingId, selectBinding, refreshMachines, machinesError } = useOmg();
  const toast = useToast();
  // The pushed screen this menu replaced surfaced a listing failure with its
  // own toast. There is no longer a screen to own that effect, so the menu
  // itself does, since it is the one place a person learns the machine list
  // is stale.
  useEffect(() => {
    if (machinesError) toast.show(machinesError, { intent: "error" });
  }, [machinesError, toast]);

  const cloudBlocked = BLOCKED_CLOUD_STATUSES.has(cloud?.status ?? "");

  const choose = useCallback(
    (id: string) => {
      void Haptics.selectionAsync();
      void selectBinding(id);
    },
    [selectBinding],
  );

  const open = useCallback(() => {
    // The old pushed screen offered pull-to-refresh; a menu has no such
    // gesture, so a fresh pairing done outside the app (`omg connect`) is
    // picked up on the NEXT open rather than making this one wait on a
    // network round trip before it can even appear.
    void refreshMachines();

    const actions: MenuAction[] = bindings.map((b) => {
      const selected = b.id === bindingId;
      // Online rows already say everything in the name (bindingLabel prefers
      // the paired folder's basename); an offline one is worth a reason.
      const detail = b.online ? "" : ` — last seen ${relativeTime(b.lastSeenAt) || "a while ago"}`;
      return {
        label: `${selected ? "✓ " : ""}${bindingLabel(b)}${detail}`,
        onPress: () => choose(b.id),
      };
    });

    actions.push({
      label: `${bindingId === CLOUD_BINDING_ID && !cloudBlocked ? "✓ " : ""}Cloud computer — ${cloudStatusLabel(cloud?.status, cloud?.blockedReason)}`,
      disabled: cloudBlocked,
      onPress: () => choose(CLOUD_BINDING_ID),
    });

    if (cloudBlocked) {
      actions.push({
        label: "Fix this on omg.dev",
        onPress: () => void Linking.openURL("https://app.omg.dev/"),
      });
    }

    /**
     * The sheet switches; the screen manages. They are not competing answers.
     *
     * An action sheet is a list of short labels, and there are things it
     * structurally cannot carry — above all "Pair a new machine by running
     * `omg connect` on it", which is the only place in the app that explains
     * pairing exists. Without a route to that screen, an account with nothing
     * paired sees one cloud entry and no way to discover it can have more.
     * Machine specs, the folder each box is bound to, and the blocked-plan
     * reason are all the same shape of problem: they need room this does not
     * have.
     */
    actions.push({
      label: "Manage computers…",
      onPress: () => router.push("/computers"),
    });

    showActionMenu("Choose a computer", actions);
  }, [bindings, bindingId, cloud, cloudBlocked, choose, refreshMachines, router]);

  return { open, cloudBlocked };
}
