import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** Everything this account has, as one JSON file.
 *
 * The counterweight to a subscription: a student can leave and take their decks
 * and their entire review history with them. It reads from Postgres rather than
 * the device, so it is exactly what sync has durably stored - which also makes it
 * the honest way to check that sync is working.
 *
 * Memory state is deliberately absent, for the same reason it has no table: it is
 * a cache over `reviews` and is recomputed by rebuildMemory. Exporting it would
 * ship a derived snapshot that is stale the moment a card is answered. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in to export." }, { status: 401 });
  }
  const userId = session.user.id;

  const [user, decks, units, reviews, asks] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, createdAt: true, currentStreak: true },
    }),
    prisma.deck.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.knowledgeUnit.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.reviewRecord.findMany({ where: { userId }, orderBy: { reviewedAt: "asc" } }),
    prisma.askRecord.findMany({ where: { userId }, orderBy: { askedAt: "asc" } }),
  ]);
  if (!user) {
    return Response.json({ error: "You must be signed in to export." }, { status: 401 });
  }

  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      // Version the shape, so a future importer can tell what it is reading.
      format: "flowrecall.export.v1",
      account: { email: user.email, joined: user.createdAt, currentStreak: user.currentStreak },
      decks,
      units,
      reviews,
      asks,
    },
    null,
    1,
  );

  // Content-Disposition rather than a data: URL, so the browser saves a file and
  // the Android WebView hands it to the system downloader.
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="flowrecall-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
