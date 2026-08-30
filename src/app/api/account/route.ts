import { auth } from "@/auth";
import { cancelRecurringBilling } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

/**
 * Self-serve account deletion - the flow Play Console requires, reachable from
 * Account > Danger Zone. Hard delete, no soft-delete or grace period.
 *
 * Deleting the User row is most of the job: StudyDay, Account and Session all
 * declare onDelete: Cascade in schema.prisma, so they go with it. Decks are not
 * in Postgres at all (they live in the client's own storage), so the caller is
 * responsible for wiping those - see clearAllLocalUserData/deleteAllBooks.
 */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, stripeSubscriptionId: true },
  });

  // Already gone. Answer 200, not 404: the client still has local data to wipe
  // and a session to drop, and a second DELETE must not strand it half-torn-down.
  if (!user) return Response.json({ deleted: true });

  // Money first. A failed cancel deletes nothing at all - the alternative is a
  // card still being charged for an account that no longer exists.
  const cancelled = await cancelRecurringBilling(user);
  if (!cancelled.ok) {
    return Response.json({ error: cancelled.reason }, { status: 502 });
  }

  await prisma.$transaction([
    prisma.user.delete({ where: { id: user.id } }),
    // VerificationToken is keyed by email identifier with no user FK, so the
    // cascade above does not reach it. Left behind, a stale token would still
    // be redeemable against a re-registration of the same address.
    ...(user.email
      ? [prisma.verificationToken.deleteMany({ where: { identifier: user.email } })]
      : []),
  ]);

  return Response.json({ deleted: true });
}
