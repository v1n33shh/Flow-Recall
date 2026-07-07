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
