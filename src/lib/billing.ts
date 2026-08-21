import { prisma } from "@/lib/prisma";

// Single source of truth for flipping a user's subscription state. Both payment
// gateways (Razorpay verify/webhook and Stripe webhook) funnel through here so
// the DB shape stays consistent regardless of which gateway fired.
//
// Every write uses updateMany (never update): a missing/deleted user becomes a
// no-op `count: 0` instead of a throw. That matters for webhooks - a thrown
// error returns 500 and the gateway keeps retrying forever for a row that will
// never exist. We log count 0 and ack instead.

type Gateway = "razorpay" | "stripe";

interface GrantProInput {
  userId: string;
  gateway: Gateway;
  // Optional gateway identifiers to persist for future reconciliation / portal
  // links. Absent on the Razorpay one-time flow, present for Stripe subs.
  customerId?: string | null;
  subscriptionId?: string | null;
  currentPeriodEnd?: Date | null;
}

export async function grantPro(input: GrantProInput): Promise<{ count: number }> {
  const { userId, gateway, customerId, subscriptionId, currentPeriodEnd } = input;

  const result = await prisma.user.updateMany({
    where: { id: userId },
    data: {
      plan: "PRO",
      planStatus: "ACTIVE",
      currentPeriodEnd: currentPeriodEnd ?? null,
      ...(gateway === "stripe"
        ? { stripeCustomerId: customerId ?? undefined, stripeSubscriptionId: subscriptionId ?? undefined }
        : { razorpayCustomerId: customerId ?? undefined, razorpaySubscriptionId: subscriptionId ?? undefined }),
    },
  });

  if (result.count === 0) {
    console.error(`grantPro: no user matched id=${userId} (gateway=${gateway})`);
  }
  return result;
}

export type EffectivePlan = "FREE" | "PRO";

// A null currentPeriodEnd means "no expiry" (e.g. a manually-granted account) -
// only a PAST date actually expires an entitlement.
function isEntitlementActive(currentPeriodEnd: Date | null): boolean {
  return currentPeriodEnd === null || currentPeriodEnd.getTime() > Date.now();
}

/**
 * Resolves the plan a user should actually be treated as right now - every
 * real Pro gate (quota checks, model routing, "already Pro?" re-purchase
 * guards) must call this instead of reading the `plan` column directly.
 *
 * `plan` alone can lag reality: Razorpay here is a one-time payment (see
 * razorpay/verify/route.ts), not a recurring subscription, so currentPeriodEnd
 * is the ONLY thing that ever expires it - and until this function existed,
 * nothing checked it, so a single ₹299/mo payment silently granted Pro
 * forever, identical to the ₹2499/yr plan.
 *
 * Self-heals: opportunistically revokes an expired Pro in the DB the first
 * time it's observed, so the stored row converges on reality even for a user
 * who never triggers this check again (rather than drifting forever).
 */
export async function resolveEffectivePlan(
  user: { id: string; plan: string; currentPeriodEnd: Date | null } | null | undefined,
): Promise<EffectivePlan> {
  if (!user || user.plan !== "PRO") return "FREE";
  if (isEntitlementActive(user.currentPeriodEnd)) return "PRO";

  await revokePro({ userId: user.id }).catch((error) => {
    console.error(`resolveEffectivePlan: failed to revoke expired Pro for user=${user.id}`, error);
  });
  return "FREE";
}

// Refreshes currentPeriodEnd on a Stripe subscription renewal, keyed by
// subscription id (not userId - the webhook only carries the subscription).
// Needed so resolveEffectivePlan's expiry check doesn't incorrectly treat an
// actively-renewing Stripe subscriber as expired once their first
// currentPeriodEnd (set once at checkout.session.completed) passes.
export async function renewPro(
  where: { stripeSubscriptionId: string },
  currentPeriodEnd: Date,
): Promise<{ count: number }> {
  return prisma.user.updateMany({
    where: { stripeSubscriptionId: where.stripeSubscriptionId },
    data: { plan: "PRO", planStatus: "ACTIVE", currentPeriodEnd },
  });
}

// Downgrade on cancellation / subscription end. Keeps the gateway ids around
// for audit; only the entitlement (plan/planStatus) is revoked.
export async function revokePro(
  where: { userId?: string; stripeSubscriptionId?: string; razorpaySubscriptionId?: string },
): Promise<{ count: number }> {
  const filter = where.userId
    ? { id: where.userId }
    : where.stripeSubscriptionId
      ? { stripeSubscriptionId: where.stripeSubscriptionId }
      : where.razorpaySubscriptionId
        ? { razorpaySubscriptionId: where.razorpaySubscriptionId }
        : null;

  if (!filter) return { count: 0 };

  return prisma.user.updateMany({
    where: filter,
    data: { plan: "FREE", planStatus: "CANCELED" },
  });
}
