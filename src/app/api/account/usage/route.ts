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

  return Response.json({
    plan,
    used,
    limit,
    // Clamped at zero: a limit lowered while an account was over it would otherwise
    // report a negative allowance, and no screen should have to defend against that.
    remaining: Math.max(0, limit - used),
  });
}
