/**
 * Switching which Computer this app talks to — a menu anchored to the machine
 * chip rather than a screen push, because choosing between two machines never
 * justified a whole navigation transition. Every call site shares this one menu
 * instead of hand-rolling its own list.
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
 * and, for blocks that are not about money, a way out to the web.
 */
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { Linking } from "react-native";

import { CLOUD_BINDING_ID } from "./config";
import { bindingLabel, cloudStatusLabel, relativeTime } from "./format";
import { type MenuOption } from "./menu";
import { useOmg } from "./provider";
import { useToast } from "./toast";

const BLOCKED_CLOUD_STATUSES = new Set(["upgrade_required", "recycled"]);

/**
 * Blocked, but NOT for a reason you would fix by paying. Mirrors the set in
 * app/computers.tsx — see that file for why `upgrade_required` is excluded
 * (App Review 3.1.1(a): no calls to action pointing at a purchasing mechanism
 * other than in-app purchase, outside the US storefront) and app/settings.tsx
 * for where the upgrade nudge went instead.
 */
const WEB_FIXABLE_CLOUD_STATUSES = new Set(["recycled"]);

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

  /**
   * Refresh on FOCUS, not on open.
   *
   * The action sheet this replaced could re-read the machine list at the moment
   * it was asked for. An anchored menu has no open hook on iOS — SwiftUI builds
   * its rows from whatever is rendered — so the list has to already be fresh
   * when the chip is pressed. Focus is the closest honest moment: a pairing
   * done outside the app (`omg connect`) lands whenever the screen comes back,
   * rather than one open later.
   */
  useFocusEffect(
    useCallback(() => {
      void refreshMachines();
    }, [refreshMachines]),
  );

  const cloudBlocked = BLOCKED_CLOUD_STATUSES.has(cloud?.status ?? "");

  const options = useMemo<MenuOption[]>(() => {
    const rows: MenuOption[] = bindings.map((b) => ({
      // Online rows already say everything in the name (bindingLabel prefers
      // the paired folder's basename); an offline one is worth a reason.
      label: b.online
        ? bindingLabel(b)
        : `${bindingLabel(b)} — last seen ${relativeTime(b.lastSeenAt) || "a while ago"}`,
      selected: b.id === bindingId,
      onPress: () => void selectBinding(b.id),
    }));

    rows.push({
      label: `Cloud computer — ${cloudStatusLabel(cloud?.status, cloud?.blockedReason)}`,
      selected: bindingId === CLOUD_BINDING_ID && !cloudBlocked,
      disabled: cloudBlocked,
      onPress: () => void selectBinding(CLOUD_BINDING_ID),
    });

    if (WEB_FIXABLE_CLOUD_STATUSES.has(cloud?.status ?? "")) {
      rows.push({
        label: "Fix this on omg.dev",
        onPress: () => void Linking.openURL("https://app.omg.dev/"),
      });
    }

    /**
     * The menu switches; the screen manages. They are not competing answers.
     *
     * A menu is a list of short labels, and there are things it structurally
     * cannot carry — above all "Pair a new machine by running `omg connect` on
     * it", which is the only place in the app that explains pairing exists.
     * Without a route to that screen, an account with nothing paired sees one
     * cloud entry and no way to discover it can have more. Machine specs, the
     * folder each box is bound to, and the blocked-plan reason are all the same
     * shape of problem: they need room this does not have.
     */
    /**
     * No icon on this row either. The machines above it are named, not
     * symbolised, and iOS reserves an icon gutter for the WHOLE menu the
     * moment one row asks for one — so a single gear pushed every machine's
     * name across and left a column of empty space beside them.
     */
    rows.push({
      label: "Manage computers…",
      onPress: () => router.push("/computers"),
    });

    return rows;
  }, [bindings, bindingId, cloud, cloudBlocked, selectBinding, router]);

  return { options, cloudBlocked };
}
