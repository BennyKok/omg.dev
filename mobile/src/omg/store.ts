/**
 * The Apple side of a purchase. NOT the omg side — see billing.ts.
 *
 * This module talks to StoreKit and to nothing else. It answers two questions:
 * what can Apple sell this person, and did a purchase produce a signed
 * transaction. It deliberately cannot answer "is this person subscribed",
 * because the device is not allowed to have an opinion about that.
 *
 * ── Why expo-iap and not react-native-iap, and definitely not RevenueCat ────
 *
 * RevenueCat is the reflex and it is wrong here. omg already verifies Apple JWS
 * centrally with @apple/app-store-server-library and binds the customer through
 * the verified appAccountToken. Adding RevenueCat would stand up a SECOND
 * source of truth for entitlements next to that one, and two systems that both
 * believe they know what you have paid for will eventually disagree — usually
 * about a refund, always in front of a customer. The client's job here is three
 * lines wide: list, buy, hand the receipt over.
 *
 * Between the two thin options, they are the same library underneath. Both are
 * hyochan's, both wrap the same OpenIAP core (`openiap-versions.json` reports
 * spec 3.2.1 / apple 3.2.1 in each), and both expose everything this needs:
 * `appAccountToken` on the request, the iOS JWS as `purchaseToken`, and Apple's
 * localised `displayPrice`. So there is no capability trade-off to weigh and
 * the choice comes down to integration cost:
 *
 *   - react-native-iap 16.x peers on `react-native-nitro-modules` — a whole
 *     extra native runtime to add, pin, and keep in step with RN 0.86.
 *   - expo-iap peers on `expo` alone and ships `expo-module.config.json` +
 *     `app.plugin.js`, so it autolinks through the prebuild this app already
 *     uses.
 *
 * Same capability, less native surface, on a build that can only ever reach
 * TestFlight. expo-iap.
 *
 * ── Why the native module is loaded lazily ─────────────────────────────────
 *
 * IAP IS A NATIVE MODULE AND CANNOT SHIP OVER THE AIR. `eas update` moves JS;
 * it cannot add StoreKit to a binary that was built without it. Every dev
 * client built before this change — including the one on the simulator right
 * now, and build 24 in review — has this module missing.
 *
 * A top-level `import from "expo-iap"` in that binary throws while the module
 * graph is being evaluated, which does not fail politely: it takes down the
 * screen that imported it, and through the router, the app. So the import is a
 * guarded `require` behind `isStoreAvailable()`, and every caller is written to
 * handle "there is no store here". The paywall then renders an honest
 * unavailable state instead of a crash, which is also exactly what a device
 * running an older build should see.
 */

import { Platform } from "react-native";

/** Products omg sells on iOS, in the order the paywall lists them. */
export type Tier = {
  /** App Store Connect product id. */
  productId: string;
  /** omg plan key the backend maps this product to. */
  plan: string;
  label: string;
  /** One line of what you get. Prices are NEVER in here — see displayPrice. */
  detail: string;
};

/**
 * The fixed computer tiers, and only those.
 *
 * StoreKit cannot charge a variable amount, so metered overage and credit
 * top-ups have no representation here and must not be implied by this UI. They
 * stay web-only. Someone who needs them is not blocked — they simply are not
 * something Apple can sell.
 *
 * Product ids are pinned by the backend (`AppStoreConfig.products`) and the two
 * lists have to agree exactly: an id present here but unmapped there is a
 * purchase the server rejects with "unmapped App Store productId" AFTER Apple
 * has taken the money.
 *
 * Labels and details mirror apps/web/src/lib/billing.ts so the two surfaces
 * describe the same product in the same words. Prices are the one thing NOT
 * mirrored — those come from StoreKit, because iOS pricing sits ~20% above web
 * to absorb Apple's commission and is set per-storefront in App Store Connect.
 */
export const TIERS: readonly Tier[] = [
  {
    productId: "dev.omg.computer.computer_s20.monthly.v1",
    plan: "computer_s20",
    label: "Starter",
    detail: "2 vCPU, 4 GB memory, 20 active hours, 3 agents at once.",
  },
  {
    productId: "dev.omg.computer.computer_s40.monthly.v1",
    plan: "computer_s40",
    label: "Starter Plus",
    detail: "2 vCPU, 4 GB memory, 40 active hours, 3 agents at once.",
  },
  {
    productId: "dev.omg.computer.computer_5.monthly.v1",
    plan: "computer_5",
    label: "Personal",
    detail: "4 vCPU, 150 active hours, 64 GB storage, 5 agents at once.",
  },
  {
    productId: "dev.omg.computer.computer_10.monthly.v1",
    plan: "computer_10",
    label: "Pro",
    detail: "8 vCPU, 300 active hours, 128 GB storage, 16 agents at once.",
  },
  {
    productId: "dev.omg.computer.computer_20.monthly.v1",
    plan: "computer_20",
    label: "Always On",
    detail: "Always-on 12 vCPU, 36 GB memory, 256 GB storage, 24 agents.",
  },
] as const;

export function tierForProduct(productId: string): Tier | undefined {
  return TIERS.find((t) => t.productId === productId);
}

export function tierForPlan(plan: string | null | undefined): Tier | undefined {
  return plan ? TIERS.find((t) => t.plan === plan) : undefined;
}

/** A tier joined with what Apple actually charges for it in this storefront. */
export type StoreProduct = Tier & {
  /**
   * APPLE'S OWN LOCALISED PRICE STRING — "$5.99", "HK$47.00", "¥900".
   *
   * Rendered verbatim and never reformatted, never parsed, never compared. The
   * App Store shows a different number in a different currency in every
   * storefront, and any price this app composes itself is wrong for most of the
   * world. It would also drift the moment pricing changes in App Store Connect.
   */
  displayPrice: string;
};

/** A completed StoreKit purchase, reduced to the only field omg needs. */
export type StorePurchase = {
  productId: string;
  /** The signed transaction JWS. This is what the backend verifies. */
  signedTransaction: string;
  /** Opaque handle used to finish the transaction once omg has recorded it. */
  raw: unknown;
};

export class StoreError extends Error {
  /** True when the person deliberately dismissed Apple's sheet. */
  readonly cancelled: boolean;
  constructor(message: string, cancelled = false) {
    super(message);
    this.name = "StoreError";
    this.cancelled = cancelled;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */

type ExpoIap = typeof import("expo-iap");

let cached: ExpoIap | null | undefined;

/**
 * The native module, or null when this binary was built without it.
 *
 * Cached including the failure, so a missing module costs one throw rather than
 * one per render.
 *
 * THE JS RESOLVING PROVES NOTHING. `require("expo-iap")` succeeds in any build
 * that has the package in node_modules, because that is a JS import — the
 * StoreKit code it needs lives in the BINARY. Verified on the simulator against
 * a dev client built before this feature: the require returned a module,
 * `isStoreAvailable()` said yes, and the failure only surfaced later as
 * `initConnection()` throwing, which the screen reported as the generic
 * "Couldn't load plans" — telling someone to retry something that cannot work
 * until they update the app.
 *
 * So the native side is probed directly. `requireOptionalNativeModule` returns
 * null instead of throwing when the module was never linked into the binary,
 * which is exactly the question being asked.
 */
function nativeStore(): ExpoIap | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("expo-modules-core") as {
      requireOptionalNativeModule?: (name: string) => unknown;
    };
    // "ExpoIap" is the name in expo-iap's expo-module.config.json.
    if (core.requireOptionalNativeModule?.("ExpoIap") == null) {
      cached = null;
      return cached;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-iap") as ExpoIap;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * A fake store, for looking at the paywall without a signed build.
 *
 * This exists because of a hard constraint, not for convenience: a real
 * purchase needs a native build AND a StoreKit sandbox account, and the
 * simulator's dev client has neither. Without this the paywall's states could
 * only be reasoned about, and mobile/AGENTS.md is explicit that reasoning about
 * a screen instead of looking at it has already shipped a broken one.
 *
 * It is off unless EXPO_PUBLIC_OMG_IAP_MOCK is set, so it cannot reach a
 * release build: EAS builds do not define it, and an undefined env var inlines
 * to undefined at build time. It NEVER produces a usable signed transaction —
 * the fake JWS is rejected by the backend verifier, by design. It can show you
 * what the screen looks like; it cannot tell you a purchase works.
 */
export const isMockStore = (process.env.EXPO_PUBLIC_OMG_IAP_MOCK ?? "") !== "";

/**
 * Which fake outcome the mock produces. Mutable so a scenario can be chosen at
 * runtime (`omg://plan?mock=cancel`) instead of by restarting Metro: the env
 * var is inlined at bundle time, so scenario-per-build would mean a full
 * rebundle to look at each state, which in practice means the states do not
 * get looked at.
 *
 * Only ever written when `isMockStore` is true — see setMockScenario.
 */
let MOCK = process.env.EXPO_PUBLIC_OMG_IAP_MOCK ?? "";

export function setMockScenario(scenario: string): void {
  if (!isMockStore) return;
  MOCK = scenario;
}

const mockDelay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Is there a store to talk to at all?
 *
 * False on Android (omg sells through Apple only for now) and false on any
 * build without the native module.
 */
export function isStoreAvailable(): boolean {
  if (isMockStore) return true;
  if (Platform.OS !== "ios") return false;
  return nativeStore() !== null;
}

let connected = false;

/** Open the StoreKit connection. Idempotent; safe to call on every mount. */
export async function connectStore(): Promise<void> {
  if (isMockStore) {
    await mockDelay(400);
    connected = true;
    return;
  }
  const iap = nativeStore();
  if (!iap) throw new StoreError("In-app purchase isn't available in this build.");
  if (connected) return;
  await iap.initConnection();
  connected = true;
}

/**
 * The tiers Apple will actually sell, with Apple's prices.
 *
 * A product missing from the response is DROPPED rather than shown at a guessed
 * price. StoreKit omits unknown SKUs silently, and the usual cause is a product
 * that is not "Ready to Submit" in App Store Connect yet — showing it anyway
 * produces a row that cannot be bought.
 */
export async function fetchTiers(): Promise<StoreProduct[]> {
  if (isMockStore) {
    await mockDelay(700);
    if (MOCK === "empty") return [];
    if (MOCK === "error") throw new StoreError("The App Store didn't respond. Try again.");
    // Deliberately not USD, to prove the UI renders whatever Apple hands back
    // rather than a dollar sign this app composed itself.
    const prices = ["HK$47.00", "HK$93.00", "HK$448.00", "HK$1,388.00", "HK$4,588.00"];
    return TIERS.map((tier, i) => ({ ...tier, displayPrice: prices[i] ?? "HK$47.00" }));
  }

  const iap = nativeStore();
  if (!iap) throw new StoreError("In-app purchase isn't available in this build.");
  const products = (await iap.fetchProducts({
    skus: TIERS.map((t) => t.productId),
    type: "subs",
  })) as unknown as { id?: string; displayPrice?: string }[];

  const byId = new Map((products ?? []).filter(Boolean).map((p) => [p.id ?? "", p]));
  return TIERS.flatMap((tier) => {
    const product = byId.get(tier.productId);
    if (!product?.displayPrice) return [];
    return [{ ...tier, displayPrice: product.displayPrice }];
  });
}

/**
 * Pull the JWS out of whatever the library handed back.
 *
 * `purchaseToken` is OpenIAP's unified field and on iOS it IS the signed
 * transaction JWS. The older iOS-specific spellings are accepted too so that a
 * library bump cannot silently strip the one value the whole feature depends
 * on — the failure mode of getting this wrong is a purchase that verifies
 * nowhere.
 */
function signedTransactionOf(purchase: Record<string, unknown>): string | null {
  for (const key of ["purchaseToken", "jwsRepresentationIOS", "jwsRepresentation"]) {
    const value = purchase[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * Buy a tier. Resolves only when StoreKit reports a real transaction.
 *
 * `requestPurchase` is event-based — its return value is explicitly documented
 * as not the outcome — so the result arrives on the purchase listeners and this
 * wraps them into one promise. Awaiting the call itself would resolve while
 * Apple's sheet is still on screen and report success for a purchase the person
 * has not made yet.
 *
 * `appAccountToken` is attached HERE, at the moment of purchase, and it is the
 * only binding between this Apple transaction and an omg account. It is passed
 * through from the server exactly as received.
 */
export async function purchaseTier(
  productId: string,
  appAccountToken: string,
): Promise<StorePurchase> {
  if (!appAccountToken) {
    // Refusing to purchase is the safe failure. A transaction without a token
    // is money Apple has taken that omg can never attribute to anyone.
    throw new StoreError("Missing purchase token. Try again in a moment.");
  }

  if (isMockStore) {
    await mockDelay(1600);
    if (MOCK === "cancel") throw new StoreError("Purchase cancelled.", true);
    if (MOCK === "purchasefail") throw new StoreError("Your purchase could not be completed.");
    return {
      productId,
      // Not a real JWS, and the backend verifier rejects it. See isMockStore.
      signedTransaction: `mock.${appAccountToken}.${productId}`,
      raw: { mock: true },
    };
  }

  const iap = nativeStore();
  if (!iap) throw new StoreError("In-app purchase isn't available in this build.");

  return await new Promise<StorePurchase>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      updated.remove();
      failed.remove();
      fn();
    };

    const updated = iap.purchaseUpdatedListener((purchase) => {
      const record = purchase as unknown as Record<string, unknown>;
      // StoreKit replays unfinished transactions, so a listener can fire for a
      // product this call did not ask for. Ignoring those keeps one purchase
      // from resolving another's promise.
      if (record.productId !== productId) return;
      const signedTransaction = signedTransactionOf(record);
      if (!signedTransaction) {
        finish(() => reject(new StoreError("Apple returned a purchase omg can't verify.")));
        return;
      }
      finish(() => resolve({ productId, signedTransaction, raw: purchase }));
    });

    const failed = iap.purchaseErrorListener((error) => {
      const code = String((error as { code?: string })?.code ?? "");
      const cancelled = code.includes("USER_CANCEL") || code.includes("UserCancel");
      finish(() =>
        reject(
          new StoreError(
            cancelled ? "Purchase cancelled." : error?.message ?? "Your purchase could not be completed.",
            cancelled,
          ),
        ),
      );
    });

    iap
      .requestPurchase({ request: { apple: { sku: productId, appAccountToken } }, type: "subs" })
      .catch((error: unknown) => {
        finish(() =>
          reject(new StoreError((error as Error)?.message ?? "Couldn't reach the App Store.")),
        );
      });
  });
}

/**
 * Everything Apple still considers this Apple ID to own.
 *
 * Apple requires a restore path, and it is not only a legal box to tick: it is
 * the recovery route for a purchase whose submit failed, and for someone who
 * reinstalled or switched device.
 */
export async function restoreTiers(): Promise<StorePurchase[]> {
  if (isMockStore) {
    await mockDelay(1200);
    if (MOCK !== "owned") return [];
    return [
      {
        productId: TIERS[2].productId,
        signedTransaction: `mock.restore.${TIERS[2].productId}`,
        raw: { mock: true },
      },
    ];
  }

  const iap = nativeStore();
  if (!iap) throw new StoreError("In-app purchase isn't available in this build.");
  await iap.restorePurchases();
  const purchases = (await iap.getAvailablePurchases()) as unknown as Record<string, unknown>[];
  return (purchases ?? []).flatMap((purchase) => {
    const productId = String(purchase.productId ?? "");
    const signedTransaction = signedTransactionOf(purchase);
    if (!signedTransaction || !tierForProduct(productId)) return [];
    return [{ productId, signedTransaction, raw: purchase }];
  });
}

/**
 * Tell StoreKit the transaction is dealt with.
 *
 * ONLY CALL THIS AFTER omg HAS RECORDED THE TRANSACTION. An unfinished
 * transaction is re-delivered on every app launch, and that replay is the
 * safety net: if the submit failed, we WANT Apple to hand it back next launch
 * so it can be recorded then. Finishing early throws that away and is how a
 * paid subscription silently never activates.
 */
export async function finishPurchase(purchase: StorePurchase): Promise<void> {
  if (isMockStore) return;
  const iap = nativeStore();
  if (!iap) return;
  try {
    await iap.finishTransaction({ purchase: purchase.raw as never, isConsumable: false });
  } catch {
    // Not fatal and not worth surfacing: the transaction stays in the queue and
    // is replayed, which is the same path a failed submit already relies on.
  }
}
