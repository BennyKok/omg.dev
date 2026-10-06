/** Native presentation of the web paywall. StoreKit remains the price and purchase owner. */
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../components";
import type { StoreProduct } from "./store";
import { Text } from "./text";
import { useTheme } from "./theme";
import { paywallStyle } from "./palette";

const DISPLAY_LABELS: Record<string, string> = {
  computer_s40: "Starter",
  computer_5: "Personal",
  computer_10: "Pro",
};
const ART: Record<string, number> = {
  computer_s40: require("../../assets/paywall/plan-starter.webp"),
  computer_5: require("../../assets/paywall/plan-personal.webp"),
  computer_10: require("../../assets/paywall/plan-pro.webp"),
};
export function planDisplayLabel(product: StoreProduct): string {
  return DISPLAY_LABELS[product.plan] ?? product.label;
}

/** Match the web default; never select a product absent from this storefront. */
export function selectedPlanProduct(
  products: StoreProduct[],
  selectedId: string | null,
  currentPlan?: string | null,
) {
  return (
    products.find((p) => p.productId === selectedId) ??
    products.find((p) => p.plan === "computer_s40" && p.plan !== currentPlan) ??
    products.find((p) => p.plan !== currentPlan) ??
    products[0]
  );
}

const FEATURES = [
  { label: "iOS & Android apps", ios: "iphone", android: "smartphone" },
  { label: "Websites", ios: "globe", android: "language" },
  { label: "Slides", ios: "rectangle.on.rectangle", android: "slideshow" },
  { label: "Games", ios: "gamecontroller", android: "sports_esports" },
  { label: "Backend + database", ios: "externaldrive", android: "storage" },
  { label: "AI usage", ios: "sparkles", android: "auto_awesome" },
  {
    label: "Your own coding agents",
    ios: "terminal",
    android: "terminal",
    personal: true,
  },
  {
    label: "Shared workspace",
    ios: "person.2",
    android: "group",
    personal: true,
  },
] as const;

function FeatureTable({ products }: { products: StoreProduct[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", paddingBottom: 8 }}>
        <View style={{ flex: 1.5 }} />
        {products.map((p) => (
          <Text
            key={p.productId}
            style={{
              flex: 1,
              textAlign: "center",
              color: colors.text,
              fontSize: 13,
              fontWeight: "600",
            }}
          >
            {planDisplayLabel(p)}
          </Text>
        ))}
      </View>
      {FEATURES.map((row) => (
        <View
          key={row.label}
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: paywallStyle.featureRowHeight,
            gap: 4,
            borderTopWidth: 1,
            borderTopColor: colors.borderSoft,
          }}
        >
          <View
            style={{
              flex: 1.5,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icon
              ios={row.ios}
              android={row.android}
              size={15}
              color={colors.textMuted}
            />
            <Text style={{ flexShrink: 1, color: colors.text, fontSize: 13 }}>
              {row.label}
            </Text>
          </View>
          {products.map((p) => {
            // Offer copy is keyed by plan, never by position or a parsed Apple price.
            const known = p.plan in DISPLAY_LABELS;
            const included =
              known &&
              (!("personal" in row) ||
                p.plan === "computer_5" ||
                p.plan === "computer_10");
            return (
              <View
                key={p.productId}
                accessible
                accessibilityLabel={`${planDisplayLabel(p)}, ${row.label}: ${included ? "Included" : "Not included"}`}
                style={{ flex: 1, alignItems: "center" }}
              >
                {included ? (
                  row.label === "AI usage" ? (
                    <Text style={{ fontSize: 12, color: colors.text }}>
                      Included
                    </Text>
                  ) : (
                    <Icon
                      ios="checkmark"
                      android="check"
                      size={15}
                      weight="semibold"
                      color={colors.text}
                    />
                  )
                ) : (
                  <Text style={{ color: colors.textMuted }}>—</Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function PlanChoiceCard({
  product,
  selected,
  current,
  disabled,
  onSelect,
}: {
  product: StoreProduct;
  selected: boolean;
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { colors } = useTheme();
  const label = planDisplayLabel(product);
  const popular = product.plan === "computer_s40";
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${label}, ${product.displayPrice} per month${popular ? ", Popular" : ""}${current ? ", current plan" : ""}`}
      testID={`plan-choice-${product.plan}`}
      disabled={disabled}
      onPress={onSelect}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        backgroundColor: colors.card,
        borderRadius: paywallStyle.cardRadius,
        borderWidth: 2,
        borderColor: selected ? colors.text : colors.border,
        padding: paywallStyle.cardPadding,
        overflow: "hidden",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: selected ? 0 : 1.5,
          borderColor: colors.textMuted,
          backgroundColor: selected ? colors.text : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? (
          <Icon
            ios="checkmark"
            android="check"
            size={12}
            color={colors.bg}
            weight="semibold"
          />
        ) : null}
      </View>
      {popular ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 15,
            right: -30,
            width: 110,
            backgroundColor: colors.brand,
            transform: [{ rotate: "45deg" }],
            paddingVertical: 3,
          }}
        >
          <Text
            style={{
              fontSize: 9,
              fontWeight: "700",
              color: "#ffffff",
              textAlign: "center",
              letterSpacing: 0.8,
            }}
          >
            POPULAR
          </Text>
        </View>
      ) : null}
      {ART[product.plan] ? (
        <Image
          source={ART[product.plan]}
          resizeMode="contain"
          style={{
            height: paywallStyle.planArtHeight,
            width: "100%",
            marginVertical: 4,
          }}
        />
      ) : (
        <View style={{ height: paywallStyle.planArtHeight }} />
      )}
      {current ? (
        <Text
          style={{ fontSize: 10, fontWeight: "600", color: colors.textMuted }}
        >
          CURRENT
        </Text>
      ) : null}
      <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.65}
        style={{
          fontSize: paywallStyle.priceSize,
          fontWeight: "700",
          letterSpacing: paywallStyle.priceTracking,
          color: colors.text,
        }}
      >
        {product.displayPrice}
      </Text>
      <Text style={{ fontSize: 11, color: colors.textMuted }}>per month</Text>
    </Pressable>
  );
}

export function PlanPicker({
  products,
  currentPlan,
  busy,
  canPurchase,
  onBuy,
  onRestore,
  restoring,
  loading,
  notice,
  onSkip,
  onClose,
}: {
  products: StoreProduct[];
  currentPlan?: string | null;
  busy: boolean;
  canPurchase: boolean;
  onBuy: (product: StoreProduct) => void;
  onRestore: () => void;
  restoring?: boolean;
  loading?: boolean;
  notice?: ReactNode;
  onSkip?: () => void;
  onClose?: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPro, setShowPro] = useState(false);
  const selected = selectedPlanProduct(products, selectedId, currentPlan);
  const pro = products.find((p) => p.plan === "computer_10");
  const visible = products.filter(
    (p) => p !== pro || showPro || p === selected || p.plan === currentPlan,
  );
  const current = selected?.plan === currentPlan;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: onClose ? insets.top : 0,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: paywallStyle.gutter,
          minHeight: 44,
        }}
      >
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onRestore}
          hitSlop={8}
        >
          <Text style={{ fontSize: 13, color: colors.textMuted }}>
            {restoring ? "Restoring…" : "Restore purchases"}
          </Text>
        </Pressable>
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={12}
          >
            <Icon
              ios="xmark"
              android="close"
              size={18}
              color={colors.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: paywallStyle.gutter, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Image
          source={require("../../assets/onboarding/plan-picnic.png")}
          resizeMode="contain"
          style={{ height: paywallStyle.heroArtHeight, width: "100%" }}
        />
        <View style={{ gap: 6 }}>
          <Text
            style={{
              fontSize: paywallStyle.titleSize,
              fontWeight: "700",
              letterSpacing: paywallStyle.titleTracking,
              color: colors.text,
            }}
          >
            Build your ideas.
          </Text>
          <Text style={{ fontSize: 16, color: colors.textMuted }}>
            Turn your ideas into a business.
          </Text>
        </View>
        {notice}
        {loading ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : visible.length ? (
          <FeatureTable products={visible} />
        ) : (
          <Text style={{ color: colors.textMuted }}>
            No plans available on this device right now.
          </Text>
        )}
        {pro && !visible.includes(pro) ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setShowPro(true)}
            style={{ alignSelf: "flex-end" }}
          >
            <Text
              style={{
                fontSize: 13,
                color: colors.textMuted,
                textDecorationLine: "underline",
              }}
            >
              See Pro
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: paywallStyle.gutter,
          paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 10),
          gap: 10,
          backgroundColor: colors.bg,
        }}
      >
        {visible.length ? (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Plans"
            style={{ flexDirection: "row", gap: paywallStyle.cardGap }}
          >
            {visible.map((p) => (
              <PlanChoiceCard
                key={p.productId}
                product={p}
                selected={p === selected}
                current={p.plan === currentPlan}
                disabled={busy}
                onSelect={() => setSelectedId(p.productId)}
              />
            ))}
          </View>
        ) : null}
        {selected ? (
          <Pressable
            testID="plan-continue"
            accessibilityRole="button"
            accessibilityLabel={`Continue with ${planDisplayLabel(selected)}, ${selected.displayPrice} per month`}
            disabled={busy || !canPurchase || current}
            accessibilityState={{ disabled: busy || !canPurchase || current }}
            onPress={() => onBuy(selected)}
            style={({ pressed }) => ({
              minHeight: paywallStyle.buttonHeight,
              paddingVertical: 12,
              borderRadius: paywallStyle.cardRadius,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.text,
              opacity:
                busy || !canPurchase || current ? 0.4 : pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: colors.bg, fontSize: 17, fontWeight: "600" }}>
              {busy && !restoring
                ? "Opening App Store…"
                : current
                  ? "Current plan"
                  : `Continue with ${planDisplayLabel(selected)}`}
            </Text>
          </Pressable>
        ) : null}
        <Text
          style={{ color: colors.textMuted, fontSize: 12, textAlign: "center" }}
        >
          Renews monthly. Cancel anytime in App Store settings.
        </Text>
        {onSkip ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSkip}
            style={{
              minHeight: paywallStyle.featureRowHeight,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}
            >
              Continue for now
            </Text>
          </Pressable>
        ) : null}
        <View
          style={{ flexDirection: "row", justifyContent: "center", gap: 16 }}
        >
          {(["terms", "privacy"] as const).map((path) => (
            <Pressable
              key={path}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(`https://omg.dev/${path}`)}
              hitSlop={8}
            >
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {path === "terms" ? "Terms of Use" : "Privacy Policy"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}
