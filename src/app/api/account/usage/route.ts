import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/billing";
import { countInCurrentMonth, generationLimitForPlan } from "@/lib/freeQuota";
import { parseTimezoneOffsetMinutes } from "@/lib/localDay";

/**
 * What is left of this month's generation allowance.
 *
 * Exists for one screen: a continuous run can work through a whole book from a
 * single tap, which makes it easy to spend a month's budget without meaning to.
 * The ceiling itself is enforced server-side either way (claimGenerationRequest,
 * before every model call) - this is so the student can see the number BEFORE
 * starting a twenty-minute run rather than being stopped part-way through one.
 *
 * Read-only, and deliberately so: it must not roll the stored counter over, or a
 * page load would become a write. `countInCurrentMonth` gives the same reading
 * `claimGenerationRequest` will take when it does the reset itself, so the two
 * cannot disagree.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in." }, { status: 401 });
  }

  // The month belongs to the student, not to the server process (always UTC on
  // Vercel) - same convention as /api/ingest and /api/streak.
  const { searchParams } = new URL(request.url);
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(searchParams.get("tzOffset"));

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      plan: true,
      currentPeriodEnd: true,
      generationRequestsUsed: true,
      generationResetAt: true,
    },
  });

  // A JWT outlives the row it names (src/auth.ts keeps a token valid when the
  // lookup finds nothing), so a token held across account deletion would otherwise
  // read as a brand-new FREE user with a full allowance. Same guard /api/ingest applies.
  if (!user) {
    return Response.json({ error: "You must be signed in." }, { status: 401 });
  }

  const plan = await resolveEffectivePlan({
    id: session.user.id,
    plan: user.plan,
    currentPeriodEnd: user.currentPeriodEnd,
  });

  const limit = generationLimitForPlan(plan);
  const used = countInCurrentMonth(
    user.generationRequestsUsed,
    user.generationResetAt,
    new Date(),
    timezoneOffsetMinutes,
  );

  // DAYS LEFT ON THE ENTITLEMENT, and it is here because nothing else can tell a
  // user their Pro is about to end.
  //
  // The Razorpay path is a ONE-TIME payment (see razorpay/verify/route.ts): it grants
  // 30 or 365 days and then `resolveEffectivePlan` above silently drops the account to
  // FREE. There is no recurring mandate to fail loudly, no dunning email, and no email
  // provider in this project at all - `src/lib/notifications.ts` is Capacitor
  // LocalNotifications, which is device-local and cannot be driven from a server. So a
  // lapsing subscriber currently finds out by discovering a feature stopped working.
  //
  // Surfacing it on the one payload every screen already fetches is the cheapest honest
  // fix: no new infrastructure, and it reaches the user on the day they open the app,
  // which for a streak product is most days.
  //
  // `null` for FREE accounts and for grants with no expiry (a manually granted account
  // has `currentPeriodEnd: null`, which means "never expires" - see
  // isEntitlementActive). Callers must treat null as "nothing to say" rather than as
  // zero, which would read as "expires today".
  const proDaysRemaining =
    plan === "PRO" && user.currentPeriodEnd
      ? Math.max(0, Math.ceil((user.currentPeriodEnd.getTime() - Date.now()) / 86_400_000))
      : null;

  return Response.json({
    plan,
    used,
    limit,
    // Clamped at zero: a limit lowered while an account was over it would otherwise
    // report a negative allowance, and no screen should have to defend against that.
    remaining: Math.max(0, limit - used),
    proDaysRemaining,
    // ISO so a client can format it in the reader's own locale rather than trusting
    // a server-rendered string.
    proEndsAt: plan === "PRO" ? (user.currentPeriodEnd?.toISOString() ?? null) : null,
  });
}
