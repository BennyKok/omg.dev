/**
 * omg's side of an App Store purchase. NOT the store side — see store.ts.
 *
 * The split matters. StoreKit knows what Apple will sell and for how much; it
 * knows nothing about whether this account is entitled to anything. omg knows
 * the entitlement and nothing about Apple's price sheet. Keeping them in two
 * modules keeps the one rule that makes this safe enforceable by reading a
 * single file: THE CLIENT IS NEVER THE AUTHORITY ON WHAT SOMEONE HAS PAID FOR.
 * Nothing in this file computes an entitlement. It asks, and it reports.
 *
 * Both endpoints are user-authenticated with the same short-lived app JWT the
 * rest of the app uses. Deliberately not the infra-signed route
 * (`/api/internal/billing/app-store/transactions`): that one is gated by
 * `verifyInfraSignature` with a shared secret, and a phone cannot hold a shared
 * secret. Anything shipped in the bundle is readable by anyone who downloads
 * the app.
 *
 * ── The appAccountToken, and why it is not the user id ──────────────────────
 *
 * Apple carries exactly one opaque field from a purchase back to us:
 * `appAccountToken`. The backend binds a transaction to a customer by that
 * value alone (`verifiedIdentity()` in control-plane/lib/app-store-billing.ts),
 * so if it is wrong or absent, money has changed hands and nobody can be
 * credited for it.
 *
 * The obvious value to put there is the omg user id. It does not work. Apple
 * types the field as a UUID — StoreKit 2 takes `Product.PurchaseOption
 * .appAccountToken(UUID)` — and omg user ids are not uniformly UUIDs. Phone
 * provisional accounts are (`29a39f1e-b60f-46c8-9e41-6824f33a4796`) but
 * ordinary better-auth accounts are 32-char nanoids
 * (`i0iDFEfXYZDuFKfnlzssdKwVnYDy9RWg`). The client physically cannot put the
 * nanoid in the field, and the backend rejects it if it somehow arrives.
 *
 * So the server mints one stable UUID per billing customer and maps it back.
 * The app fetches it and passes it through UNCHANGED. Never generate one here,
 * never cache it across sign-ins, never fall back to a locally generated UUID
 * when the fetch fails — a made-up token is a purchase that can never be
 * attributed, which is strictly worse than a purchase that never happened.
 */

import { getAuthToken } from "./auth";
import { CONTROLPLANE_ORIGIN } from "./config";
import { parseCatalogTiers, type CatalogTier } from "./plan-specs";

/** What the server says about this account's ability to buy, before we ask Apple for anything. */
export type PurchaseAccount = {
  /** Stable per-customer UUID. Pass to StoreKit verbatim. */
  appAccountToken: string;
  /**
   * What omg sells and what each tier contains — ids included, prices NOT.
   *
   * Null when this control plane published no catalog at all, which is an
   * ordinary answer from a server older than the field. The caller falls back
   * to the product ids in the bundle and renders no specs; it must never fall
   * back to remembered numbers. An EMPTY array is a different answer — "nothing
   * is on sale" — and is passed through as such.
   *
   * Prices are absent by contract. Apple's `displayPrice` is the only price
   * string this app renders, because it is per-storefront and localised, and a
   * second price from omg could only ever contradict it.
   */
  tiers: CatalogTier[] | null;
  /**
   * False when buying here would double-bill. The live case is an account
   * already subscribed through Stripe on the web: Apple would happily take a
   * second payment and omg would owe a refund. This is a normal state for an
   * existing customer, not an edge case, so the paywall gives it real copy.
   */
  canPurchase: boolean;
  /** Machine-readable reason `canPurchase` is false, e.g. "stripe_subscription_active". */
  reason?: string | null;
  /** The plan the server believes this account is on right now. */
  plan?: string | null;
};

/** The authoritative result of a purchase, as decided by omg and Apple — never by this app. */
export type Entitlement = {
  plan: string;
  status: "active" | "past_due" | "canceled";
  providerSubscriptionId?: string | null;
  /**
   * True when this exact transaction had already been recorded. A replay is a
   * SUCCESS, not an error — it is the normal answer to Restore Purchases and to
   * a transaction StoreKit re-delivers after a failed submit.
   */
  replayed?: boolean;
};

export class BillingError extends Error {
  readonly status: number;
  /** Server's machine-readable code, when it sent one. */
  readonly code?: string;
  /** Plan the server reported alongside a conflict, so the UI can name it. */
  readonly plan?: string;

  constructor(message: string, status: number, code?: string, plan?: string) {
    super(message);
    this.name = "BillingError";
    this.status = status;
    this.code = code;
    this.plan = plan;
  }

  /**
   * The account already pays through Stripe. Distinguished because it is the
   * one failure that is not a failure — it needs an explanation, not a retry.
   */
  get isStripeConflict(): boolean {
    return this.status === 409 || this.code === "stripe_subscription_active";
  }
}

/**
 * The same off-by-default switch the fake store uses (see store.ts), read here
 * rather than imported so the two modules stay independent.
 *
 * Mock mode has to cover BOTH sides or it covers neither: a fake store paired
 * with the real control plane just renders whatever error the billing routes
 * happen to return today, which is what this screen did before this existed
 * ("Not found", because the routes were not deployed yet). Being unable to look
 * at the paywall until the backend ships is exactly the coupling that gets a
 * screen shipped unseen.
 *
 * Never reachable in a release build: EAS does not define the variable, and an
 * undefined EXPO_PUBLIC_* inlines to undefined at bundle time.
 */
let MOCK = process.env.EXPO_PUBLIC_OMG_IAP_MOCK ?? "";
const isMock = MOCK !== "";

/** Mirrors store.ts's setMockScenario; see the note there. */
export function setMockBillingScenario(scenario: string): void {
  if (!isMock) return;
  MOCK = scenario;
}

/** A fixed UUID, so the mock exercises the real "pass it through" path. */
const MOCK_ACCOUNT_TOKEN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * A stand-in for the catalog the control plane sends.
 *
 * THIS IS NOT A COPY OF THE CATALOG. It is raw JSON in the shape the server
 * promises, fed through the SAME `parseCatalogTiers` the network path uses, so
 * that looking at the screen exercises the real parser rather than a shortcut
 * around it. It exists because the endpoint is being built in another repo in
 * parallel and the screen had to be seen before it deployed.
 *
 * The numbers match the vibes catalog as of writing and were agreed field by
 * field with the control-plane side. They are still MOCK numbers: what they
 * prove is that the screen renders whatever it is handed and computes nothing.
 * The real payload is the one that ships.
 */
const MOCK_CATALOG: unknown = [
  {
    productId: "dev.omg.computer.computer_s20.monthly.v1",
    plan: "computer_s20",
    label: "Starter",
    specs: { parallelAgents: 3, vcpus: 2, memoryMb: 4096, diskGb: 16, computeHours: 20, alwaysOn: false },
  },
  {
    productId: "dev.omg.computer.computer_s40.monthly.v1",
    plan: "computer_s40",
    label: "Starter",
    specs: { parallelAgents: 3, vcpus: 2, memoryMb: 4096, diskGb: 16, computeHours: 40, alwaysOn: false },
  },
  {
    productId: "dev.omg.computer.computer_5.monthly.v1",
    plan: "computer_5",
    label: "Personal",
    specs: { parallelAgents: 5, vcpus: 4, memoryMb: 8192, diskGb: 64, computeHours: 150, alwaysOn: false },
  },
  {
    productId: "dev.omg.computer.computer_10.monthly.v1",
    plan: "computer_10",
    label: "Pro",
    specs: { parallelAgents: 16, vcpus: 8, memoryMb: 16384, diskGb: 128, computeHours: 300, alwaysOn: false },
  },
  // Always On is not sold on iOS, so the mock does not pretend it is. A mock
  // that shows a rung production won't is a screenshot waiting to mislead
  // someone — including whoever reviews this screen next.
];

/** The same list with every `specs` null — a server that can sell but cannot describe. */
const MOCK_CATALOG_NO_SPECS: unknown = (MOCK_CATALOG as Record<string, unknown>[]).map((tier) => ({
  ...tier,
  specs: null,
}));

async function billingFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new BillingError("Please sign in again.", 401);

  let response: Response;
  try {
    response = await fetch(`${CONTROLPLANE_ORIGIN}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    // Distinguished from an HTTP error by status 0. The caller cares: a
    // transport failure after a completed purchase must not be reported as a
    // failed purchase.
    throw new BillingError("Couldn't reach omg. Check your connection.", 0);
  }

  const text = await response.text().catch(() => "");
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const code = typeof data.error === "string" ? data.error : undefined;
    const plan = typeof data.plan === "string" ? data.plan : undefined;
    const message =
      typeof data.message === "string" ? data.message : code ?? `Request failed (${response.status})`;
    throw new BillingError(message, response.status, code, plan);
  }
  return data as T;
}

/**
 * The token to purchase with, and whether purchasing is allowed at all.
 *
 * Called before the paywall offers anything, because both answers change what
 * is drawn: no token means no purchase can be attributed, so no buy button.
 */
export async function fetchPurchaseAccount(): Promise<PurchaseAccount> {
  if (isMock) {
    await new Promise((r) => setTimeout(r, 500));
    // Every branch goes through parseCatalogTiers, exactly like the network
    // path, so the mock cannot accidentally hand the screen a shape the real
    // parser would have rejected.
    //   nocatalog — a control plane older than the `tiers` field
    //   nospecs   — sells the tiers but describes none of them
    //   nothing   — a real, empty catalog: omg sells nothing right now
    const raw =
      MOCK === "nocatalog" ? undefined : MOCK === "nospecs" ? MOCK_CATALOG_NO_SPECS : MOCK === "nothing" ? [] : MOCK_CATALOG;
    const tiers = parseCatalogTiers(raw);
    if (MOCK === "stripe") {
      return {
        appAccountToken: MOCK_ACCOUNT_TOKEN,
        canPurchase: false,
        reason: "stripe_subscription_active",
        plan: "computer_5",
        tiers,
      };
    }
    return { appAccountToken: MOCK_ACCOUNT_TOKEN, canPurchase: true, plan: null, tiers };
  }
  const data = await billingFetch<Record<string, unknown>>(
    "/api/billing/app-store/account-token",
  );
  if (typeof data?.appAccountToken !== "string" || !data.appAccountToken) {
    throw new BillingError("omg did not return a purchase token.", 500);
  }
  return {
    appAccountToken: data.appAccountToken,
    canPurchase: data.canPurchase !== false,
    reason: typeof data.reason === "string" ? data.reason : null,
    plan: typeof data.plan === "string" ? data.plan : null,
    // Validated rather than trusted. Everything this returns is drawn on a
    // payment surface, so a malformed tier is dropped and an incomplete spec
    // becomes null — never a half-filled card. See plan-specs.ts.
    tiers: parseCatalogTiers(data.tiers),
  };
}

/**
 * Hand Apple's signed transaction to omg and get the entitlement back.
 *
 * This is a LATENCY OPTIMISATION, not the entitlement path. Apple's
 * server-to-server notification is the source of truth and arrives whether or
 * not this call ever succeeds. That is why a failure here is not a failed
 * purchase, and why the caller must never say "purchase failed" when this
 * throws — see the purchase flow in app/plan.tsx.
 *
 * The JWS is passed straight through, unparsed. Decoding it on device to decide
 * anything would be inventing a second, weaker verifier next to the real one.
 */
export async function submitSignedTransaction(signedTransaction: string): Promise<Entitlement> {
  if (isMock) {
    await new Promise((r) => setTimeout(r, 900));
    // The state worth being able to look at: Apple charged, omg did not answer.
    if (MOCK === "submitfail") throw new BillingError("Couldn't reach omg.", 0);
    const plan = signedTransaction.split(".").pop()?.split("computer.")[1]?.replace(".monthly.v1", "");
    return {
      plan: plan || "computer_5",
      status: "active",
      providerSubscriptionId: "2000000900000001",
      replayed: MOCK === "owned",
    };
  }
  return await billingFetch<Entitlement>("/api/billing/app-store/transactions", {
    method: "POST",
    body: JSON.stringify({ signedTransaction }),
  });
}
