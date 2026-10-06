/** Plan presentation shared with Settings. Both exits retain the onboarding task. */
import { useEffect } from "react";
import { PlanPicker } from "./plan-picker";
import { usePurchaseFlow } from "./purchase-flow";
import { Text } from "./text";
import { useTheme } from "./theme";

export function PlanScreen({
  onPurchased,
  onSkip,
  onClose,
}: {
  onPurchased: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { phase, products, account, busy, buy, restore, loadError } =
    usePurchaseFlow();
  useEffect(() => {
    if (phase.kind === "done" || phase.kind === "activating") onPurchased();
  }, [phase.kind, onPurchased]);
  return (
    <PlanPicker
      products={products}
      currentPlan={account?.plan}
      busy={busy}
      canPurchase={!!account?.canPurchase}
      loading={phase.kind === "loading"}
      onBuy={(product) => void buy(product)}
      onRestore={() => void restore()}
      restoring={phase.kind === "restoring"}
      onSkip={onSkip}
      onClose={onClose}
      notice={
        loadError ||
        phase.kind === "unavailable" ||
        account?.canPurchase === false ? (
          <Text style={{ color: colors.textMuted }}>
            {loadError ??
              (phase.kind === "unavailable"
                ? phase.message
                : "Purchases are unavailable for this account.")}
          </Text>
        ) : null
      }
    />
  );
}
